let audioCtx = null;
let audioBuffer = null;
let sourceNode = null;
let analyserNode = null;
let dadosTempo = null;
let dadosFrequencia = null;
let streamDest = null;
let ultimoUrlExportado = null;
let nomeFicheiroBase = 'waveform-ruc';

let estaTocando = false;
let tempoInicioCtx = 0;
let offsetPausa = 0;
let paragemManual = false;

// Canvas de exportação: 420 × 84 px, com uma linha de 19 bolinhas.
const LARGURA_FRAME = 420;
const ALTURA_FRAME = 84;
const NUM_BOLINHAS = 19;
const COR_RUC = '#E31E24';
const ESPACO_BOLINHAS = 6; // espaço livre entre as bordas das bolinhas
const DIAMETRO_MIN = 4;
const DIAMETRO_MAX = 24;
const FREQUENCIA_MIN = 80;
const FREQUENCIA_MAX = 10000;

// Cada bolinha tem o seu próprio nível suavizado, calculado a partir
// de uma faixa de frequências diferente do áudio.
let niveisBolinha = Array.from({ length: NUM_BOLINHAS }, () => 0);

let gravando = false;
let mediaRecorder = null;
let chunksGravacao = [];

// Referências DOM.
let elDropZone, elInputAudio, elBtnImport, elBtnPlay, elBtnExport, elSlider, elStatus;

function setup() {
  let cnv = createCanvas(LARGURA_FRAME, ALTURA_FRAME);
  cnv.parent('canvas-wrapper');
  pixelDensity(1);
  ligarInterface();
}

function draw() {
  clear();

  const sensibilidade = parseFloat(elSlider.value);
  const niveisAlvo = Array.from({ length: NUM_BOLINHAS }, () => 0);

  if (estaTocando && audioBuffer && analyserNode && dadosTempo && dadosFrequencia) {
    analyserNode.getByteTimeDomainData(dadosTempo);
    analyserNode.getFloatFrequencyData(dadosFrequencia);

    // RMS global funciona como porta de silêncio: em pausas, todas as
    // bolinhas regressam ao mesmo tamanho mínimo.
    let somaQuadrados = 0;
    for (const amostra of dadosTempo) {
      const normalizado = (amostra - 128) / 128;
      somaQuadrados += normalizado * normalizado;
    }
    const rmsGlobal = sqrt(somaQuadrados / dadosTempo.length);

    if (rmsGlobal > 0.003) {
      const frequenciaFinal = Math.min(FREQUENCIA_MAX, audioCtx.sampleRate / 2);
      const frequenciaInicial = Math.min(FREQUENCIA_MIN, frequenciaFinal / 2);
      const razaoFrequencias = frequenciaFinal / frequenciaInicial;

      for (let i = 0; i < NUM_BOLINHAS; i++) {
        // Divide o espectro em faixas logarítmicas. Todas são analisadas
        // em simultâneo, sem seguir o progresso da reprodução da esquerda
        // para a direita.
        const limiteInferior = frequenciaInicial * Math.pow(razaoFrequencias, i / NUM_BOLINHAS);
        const limiteSuperior = frequenciaInicial * Math.pow(razaoFrequencias, (i + 1) / NUM_BOLINHAS);
        const binInicial = Math.max(0, Math.floor(limiteInferior * analyserNode.fftSize / audioCtx.sampleRate));
        const binFinal = Math.min(
          dadosFrequencia.length,
          Math.max(binInicial + 1, Math.ceil(limiteSuperior * analyserNode.fftSize / audioCtx.sampleRate))
        );

        let somaPotencia = 0;
        let numeroBins = 0;
        for (let bin = binInicial; bin < binFinal; bin++) {
          const db = dadosFrequencia[bin];
          if (Number.isFinite(db)) {
            const amplitude = Math.pow(10, db / 20);
            somaPotencia += amplitude * amplitude;
            numeroBins++;
          }
        }

        const rmsFaixa = numeroBins > 0 ? Math.sqrt(somaPotencia / numeroBins) : 0;
        const dbFaixa = 20 * Math.log10(Math.max(rmsFaixa, 0.000001));
        const intensidade = constrain((dbFaixa + 62) / 42, 0, 1);
        niveisAlvo[i] = pow(intensidade, 0.8) * sensibilidade;
      }
    }
  }

  const passo = width / NUM_BOLINHAS;
  const diametroMaximoVisivel = Math.min(DIAMETRO_MAX, passo - ESPACO_BOLINHAS);
  const centroY = height / 2;

  noStroke();
  fill(COR_RUC);

  for (let i = 0; i < NUM_BOLINHAS; i++) {
    const alvo = constrain(niveisAlvo[i], 0, 1);
    const fatorSuavizacao = alvo > niveisBolinha[i] ? 0.65 : 0.16;
    niveisBolinha[i] = lerp(niveisBolinha[i], alvo, fatorSuavizacao);

    const diametro = DIAMETRO_MIN
      + niveisBolinha[i] * (diametroMaximoVisivel - DIAMETRO_MIN);

    // Centros fixos: o tamanho muda, mas a bolinha não desliza pela linha.
    const centroX = passo * (i + 0.5);
    circle(centroX, centroY, diametro);
  }
}

function ligarInterface() {
  elDropZone = document.getElementById('drop-zone');
  elInputAudio = document.getElementById('input-audio');
  elBtnImport = document.getElementById('btn-import');
  elBtnPlay = document.getElementById('btn-play');
  elBtnExport = document.getElementById('btn-export');
  elSlider = document.getElementById('slider-sensibilidade');
  elStatus = document.getElementById('status-texto');

  elBtnImport.addEventListener('click', () => {
    garantirAudioContext();
    elInputAudio.value = '';
    elInputAudio.click();
  });

  elInputAudio.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      carregarAudio(e.target.files[0]);
    }
  });

  elBtnPlay.addEventListener('click', alternarReproducao);
  elBtnExport.addEventListener('click', iniciarExportacao);

  elDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elDropZone.classList.add('drag-over');
  });

  elDropZone.addEventListener('dragleave', () => {
    elDropZone.classList.remove('drag-over');
  });

  elDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elDropZone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      carregarAudio(e.dataTransfer.files[0]);
    }
  });
}

function garantirAudioContext() {
  if (!audioCtx) {
    let AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (!analyserNode) {
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.connect(audioCtx.destination);
    dadosTempo = new Uint8Array(analyserNode.fftSize);
    dadosFrequencia = new Float32Array(analyserNode.frequencyBinCount);
  }
}

async function carregarAudio(ficheiro) {
  let extensaoValida = /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(ficheiro.name);
  if (!ficheiro.type.startsWith('audio/') && !extensaoValida) {
    elStatus.textContent = 'Formato não suportado. Utiliza .mp3, .wav, .m4a ou .ogg.';
    return;
  }

  pararAudioAtual(true);
  audioBuffer = null;
  offsetPausa = 0;
  niveisBolinha.fill(0);

  nomeFicheiroBase = ficheiro.name
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-');

  elBtnPlay.disabled = true;
  elBtnExport.disabled = true;
  elStatus.textContent = `A carregar "${ficheiro.name}"...`;

  try {
    garantirAudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    let arrayBuffer = await ficheiro.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    elBtnPlay.disabled = false;
    elBtnExport.disabled = false;
    elStatus.textContent = `Pronto: ${ficheiro.name} (${audioBuffer.duration.toFixed(1)}s)`;
  } catch (erro) {
    console.error('Erro ao descodificar áudio:', erro);
    elStatus.textContent = 'Erro ao ler o ficheiro. Verifica se é um .mp3 ou .wav válido.';
  }
}

async function iniciarReproducao(inicioEmSegundos) {
  if (!audioBuffer) return;

  garantirAudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  pararAudioAtual(true);

  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(analyserNode);

  if (gravando && streamDest) {
    sourceNode.connect(streamDest);
  }

  paragemManual = false;
  tempoInicioCtx = audioCtx.currentTime - inicioEmSegundos;
  estaTocando = true;

  sourceNode.onended = () => {
    if (paragemManual) {
      paragemManual = false;
      return;
    }

    estaTocando = false;
    offsetPausa = 0;

    if (gravando) {
      finalizarExportacao();
    }
  };

  sourceNode.start(0, inicioEmSegundos);
}

function pararAudioAtual(foiManual) {
  if (sourceNode) {
    paragemManual = foiManual;
    try {
      sourceNode.stop();
      sourceNode.disconnect();
    } catch (e) {}
    sourceNode = null;
  }
  estaTocando = false;
}

async function alternarReproducao() {
  if (!audioBuffer || gravando) return;

  if (estaTocando) {
    offsetPausa = audioCtx.currentTime - tempoInicioCtx;
    pararAudioAtual(true);
  } else {
    if (offsetPausa >= audioBuffer.duration) {
      offsetPausa = 0;
    }
    await iniciarReproducao(offsetPausa);
  }
}

async function iniciarExportacao() {
  if (!audioBuffer || gravando) return;

  garantirAudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  if (ultimoUrlExportado) {
    URL.revokeObjectURL(ultimoUrlExportado);
    ultimoUrlExportado = null;
  }

  pararAudioAtual(true);
  offsetPausa = 0;
  niveisBolinha.fill(0);
  gravando = true;
  chunksGravacao = [];

  elBtnImport.disabled = true;
  elBtnPlay.disabled = true;
  elBtnExport.disabled = true;
  elStatus.textContent = 'A gravar waveform transparente... Aguarda o fim do áudio.';

  let canvasStream = document.querySelector('#canvas-wrapper canvas').captureStream(60);
  streamDest = audioCtx.createMediaStreamDestination();

  let streamFinal = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...streamDest.stream.getAudioTracks()
  ]);

  let opcoes = { mimeType: 'video/webm;codecs=vp9,opus' };
  if (!MediaRecorder.isTypeSupported(opcoes.mimeType)) {
    opcoes = { mimeType: 'video/webm' };
  }

  mediaRecorder = new MediaRecorder(streamFinal, opcoes);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunksGravacao.push(e.data);
  };

  mediaRecorder.onstop = () => {
    let nomeSaida = `${nomeFicheiroBase}-waveform.webm`;
    let blob = new Blob(chunksGravacao, { type: 'video/webm' });
    ultimoUrlExportado = URL.createObjectURL(blob);

    let linkAuto = document.createElement('a');
    linkAuto.href = ultimoUrlExportado;
    linkAuto.download = nomeSaida;
    linkAuto.click();

    elStatus.innerHTML = `Concluído! Ficheiro transferido: <a href="${ultimoUrlExportado}" download="${nomeSaida}">${nomeSaida}</a>`;

    gravando = false;
    streamDest = null;
    elBtnImport.disabled = false;
    elBtnPlay.disabled = false;
    elBtnExport.disabled = false;
  };

  mediaRecorder.start();
  await iniciarReproducao(0);
}

function finalizarExportacao() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    setTimeout(() => {
      mediaRecorder.stop();
    }, 450);
  }
}
