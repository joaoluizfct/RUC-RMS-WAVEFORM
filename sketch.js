let audioCtx = null;
let audioBuffer = null;
let sourceNode = null;
let analyserNode = null;
let dadosTempo = null;
let streamDest = null;
let ultimoUrlExportado = null;
let nomeFicheiroBase = 'waveform-ruc';

let estaTocando = false;
let tempoInicioCtx = 0;
let offsetPausa = 0;
let paragemManual = false;

// Especificações exatas da caixa no Figma (420x84, spacing 6, 19 bolinhas)
const LARGURA_FRAME = 420;
const ALTURA_FRAME = 84;
const LARGURA_MAX_UTIL = 412;
const NUM_BOLINHAS = 19;
const ESPACAMENTO_GAP = 6;
const DIAMETRO_MIN = 4;
const DIAMETRO_MAX = 36;
const COR_RUC = '#E31E24';

// Mapa estático dos 19 valores RMS extraídos do áudio completo
let mapaRMSEstatico = [];
let diametrosVisuais = [];
let nivelVivo = 0;

let gravando = false;
let mediaRecorder = null;
let chunksGravacao = [];

// Referências DOM
let elDropZone, elInputAudio, elBtnImport, elBtnPlay, elBtnExport, elSlider, elStatus;

function setup() {
  let cnv = createCanvas(LARGURA_FRAME, ALTURA_FRAME);
  cnv.parent('canvas-wrapper');
  pixelDensity(1);

  mapaRMSEstatico = Array.from({ length: NUM_BOLINHAS }, () => 0);
  diametrosVisuais = Array.from({ length: NUM_BOLINHAS }, () => DIAMETRO_MIN);

  ligarInterface();
}

function draw() {
  // Fundo 100% transparente (canal alfa)
  clear();

  let sensibilidade = parseFloat(elSlider.value);
  let rmsInstantaneo = 0;
  let progressoAudio = 0;

  if (estaTocando && audioBuffer && analyserNode && dadosTempo) {
    // Posição atual da leitura ao longo da faixa (0.0 no início -> 1.0 no fim)
    let tempoDecorrido = audioCtx.currentTime - tempoInicioCtx;
    progressoAudio = constrain(tempoDecorrido / audioBuffer.duration, 0, 1);

    // Energia vocal em tempo real (RMS instantâneo)
    analyserNode.getByteTimeDomainData(dadosTempo);
    let somaQuadrados = dadosTempo.reduce((acc, amostra) => {
      let normalizado = (amostra - 128) / 128.0;
      return acc + normalizado * normalizado;
    }, 0);

    let rmsBruto = sqrt(somaQuadrados / dadosTempo.length);
    rmsInstantaneo = constrain(pow(rmsBruto * 3.2 * sensibilidade, 0.85), 0, 1);
  }

  // Ataque rápido nas sílabas e decaimento suave nas pausas
  let fatorSuavizacao = rmsInstantaneo > nivelVivo ? 0.55 : 0.22;
  nivelVivo = lerp(nivelVivo, rmsInstantaneo, fatorSuavizacao);

  // Calcula o diâmetro de cada bolinha fixa sem deslocar a onda lateralmente
  diametrosVisuais = diametrosVisuais.map((dAtual, i) => {
    let baseEstatica = mapaRMSEstatico[i] || 0;
    let posNorm = i / (NUM_BOLINHAS - 1);

    let intensidadeAlvo = 0;

    if (!audioBuffer) {
      // Estado inicial sem ficheiro: leve curva em repouso
      intensidadeAlvo = sin(posNorm * PI) * 0.1;
    } else if (!estaTocando) {
      // Áudio carregado mas parado: mostra a silhueta RMS estática em escala contida
      intensidadeAlvo = baseEstatica * 0.45;
    } else {
      // Em reprodução: as bolinhas crescem no próprio lugar conforme o RMS estático + voz viva
      let distPlayhead = abs(posNorm - progressoAudio);
      let focoPlayhead = exp(-pow(distPlayhead / 0.11, 2));

      intensidadeAlvo =
        baseEstatica * (0.25 + 0.75 * nivelVivo) +
        focoPlayhead * nivelVivo * 0.32;
    }

    intensidadeAlvo = constrain(intensidadeAlvo, 0, 1);
    let dAlvo = lerp(DIAMETRO_MIN, DIAMETRO_MAX, intensidadeAlvo);

    return constrain(lerp(dAtual, dAlvo, 0.38), DIAMETRO_MIN, DIAMETRO_MAX);
  });

  // Auto Layout horizontal centrado com 6px exatos entre bordas
  let somaDiametros = diametrosVisuais.reduce((acc, d) => acc + d, 0);
  let larguraTotalIdeal = somaDiametros + (NUM_BOLINHAS - 1) * ESPACAMENTO_GAP;

  let escalaX = larguraTotalIdeal > LARGURA_MAX_UTIL ? LARGURA_MAX_UTIL / larguraTotalIdeal : 1;
  let gapEfetivo = ESPACAMENTO_GAP * escalaX;
  let larguraFinal = larguraTotalIdeal * escalaX;

  let cursorX = (width - larguraFinal) / 2;
  let centroY = height / 2;

  noStroke();
  fill(COR_RUC);

  diametrosVisuais.forEach((d) => {
    let dDesenho = d * escalaX;
    let x = cursorX + dDesenho / 2;
    circle(x, centroY, dDesenho);
    cursorX += dDesenho + gapEfetivo;
  });
}

// Lê o ficheiro inteiro e extrai os 19 valores RMS estáticos com gradação espacial
function extrairMapaRMSEstatico(buffer) {
  let numCanais = buffer.numberOfChannels;
  let totalAmostras = buffer.length;
  let tamanhoSegmento = Math.max(1, Math.floor(totalAmostras / NUM_BOLINHAS));

  let canais = Array.from({ length: numCanais }, (_, c) => buffer.getChannelData(c));
  let rmsBrutos = [];

  for (let i = 0; i < NUM_BOLINHAS; i++) {
    let inicio = i * tamanhoSegmento;
    let fim = i === NUM_BOLINHAS - 1 ? totalAmostras : Math.min(totalAmostras, inicio + tamanhoSegmento);
    let somaQuadrados = 0;
    let contagem = 0;

    // Passo de amostragem de 4 em 4 para leitura instantânea mesmo em ficheiros longos
    for (let s = inicio; s < fim; s += 4) {
      let amostraMono = 0;
      for (let c = 0; c < numCanais; c++) {
        amostraMono += canais[c][s];
      }
      amostraMono /= numCanais;
      somaQuadrados += amostraMono * amostraMono;
      contagem++;
    }

    let rms = contagem > 0 ? Math.sqrt(somaQuadrados / contagem) : 0;
    rmsBrutos.push(rms);
  }

  let picoMax = Math.max(...rmsBrutos, 0.0001);

  // Normaliza e aplica curva suave para destacar as nuances da voz
  let normalizados = rmsBrutos.map((v) => Math.pow(v / picoMax, 0.85));

  // Aplica gradação espacial de Wucius Wong entre bolinhas vizinhas
  let gradados = normalizados.map((val, i, arr) => {
    let ant = i > 0 ? arr[i - 1] : val;
    let prox = i < arr.length - 1 ? arr[i + 1] : val;
    return ant * 0.18 + val * 0.64 + prox * 0.18;
  });

  let picoGradado = Math.max(...gradados, 0.0001);
  return gradados.map((v) => v / picoGradado);
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
  mapaRMSEstatico = Array.from({ length: NUM_BOLINHAS }, () => 0);

  nomeFicheiroBase = ficheiro.name
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-');

  elBtnPlay.disabled = true;
  elBtnExport.disabled = true;
  elStatus.textContent = `A analisar RMS de "${ficheiro.name}"...`;

  try {
    garantirAudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    let arrayBuffer = await ficheiro.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // Preenche imediatamente o perfil RMS estático das 19 bolinhas
    mapaRMSEstatico = extrairMapaRMSEstatico(audioBuffer);

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
  nivelVivo = 0;
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
