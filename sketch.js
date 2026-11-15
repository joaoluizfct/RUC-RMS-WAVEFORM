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

// Canvas de exportação: 420 × 84 px
const LARGURA_FRAME = 420;
const ALTURA_FRAME = 84;
const NUM_BOLINHAS_BASE = 19;
const NUM_BOLINHAS_MIN = 11;
const NUM_BOLINHAS_MAX = 42;
const COR_RUC = '#E31E24';
const ESPACO_BOLINHAS = 6;
const DIAMETRO_MIN = 4;
const DIAMETRO_MAX = 24;
const FREQUENCIA_MIN = 80;
const FREQUENCIA_MAX = 10000;

let numBolinhasAtuais = NUM_BOLINHAS_BASE;
let niveisBolinha = Array.from({ length: numBolinhasAtuais }, () => 0);

let gravando = false;
let mediaRecorder = null;
let chunksGravacao = [];

let elDropZone, elInputAudio, elBtnImport, elBtnPlay, elBtnExport, elSlider, elStatus;

function ajusteBolhasTamanho(novoTamanho) {
  if (novoTamanho === niveisBolinha.length) return;

  if (novoTamanho > niveisBolinha.length) {
    for (let i = niveisBolinha.length; i < novoTamanho; i++) {
      niveisBolinha.push(0);
    }
  } else {
    niveisBolinha.length = novoTamanho;
  }
}

function setup() {
  let cnv = createCanvas(LARGURA_FRAME, ALTURA_FRAME);
  cnv.parent('canvas-wrapper');
  pixelDensity(1);
  ligarInterface();
}

function draw() {
  clear();

  const sensibilidade = parseFloat(elSlider.value);
  let energiaVoz = 0;

  if (estaTocando && audioBuffer && analyserNode && dadosTempo && dadosFrequencia) {
    analyserNode.getByteTimeDomainData(dadosTempo);
    analyserNode.getFloatFrequencyData(dadosFrequencia);

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

      const niveisAlvoTemp = Array.from({ length: numBolinhasAtuais }, () => 0);

      for (let i = 0; i < numBolinhasAtuais; i++) {
        const limiteInferior = frequenciaInicial * Math.pow(razaoFrequencias, i / numBolinhasAtuais);
        const limiteSuperior = frequenciaInicial * Math.pow(razaoFrequencias, (i + 1) / numBolinhasAtuais);
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
        niveisAlvoTemp[i] = pow(intensidade, 0.8) * sensibilidade;
      }

      energiaVoz = constrain((rmsGlobal - 0.003) / 0.045, 0, 1);

      const alvoTotalBolhas = Math.round(lerp(NUM_BOLINHAS_MIN, NUM_BOLINHAS_MAX, energiaVoz));
      numBolinhasAtuais = lerp(numBolinhasAtuais, alvoTotalBolhas, 0.12);
      numBolinhasAtuais = constrain(numBolinhasAtuais, NUM_BOLINHAS_MIN, NUM_BOLINHAS_MAX);

      ajusteBolhasTamanho(Math.round(numBolinhasAtuais));

      for (let i = 0; i < niveisBolinha.length; i++) {
        const alvo = i < niveisAlvoTemp.length ? niveisAlvoTemp[i] : 0;
        const fatorSuavizacao = alvo > niveisBolinha[i] ? 0.7 : 0.18;
        niveisBolinha[i] = lerp(niveisBolinha[i], alvo, fatorSuavizacao);
      }
    } else {
      const alvoTotalBolhas = NUM_BOLINHAS_MIN;
      numBolinhasAtuais = lerp(numBolinhasAtuais, alvoTotalBolhas, 0.18);
      ajusteBolhasTamanho(Math.round(numBolinhasAtuais));

      for (let i = 0; i < niveisBolinha.length; i++) {
        niveisBolinha[i] = lerp(niveisBolinha[i], 0, 0.2);
      }
    }
  } else {
    const alvoTotalBolhas = NUM_BOLINHAS_MIN;
    numBolinhasAtuais = lerp(numBolinhasAtuais, alvoTotalBolhas, 0.18);
    ajusteBolhasTamanho(Math.round(numBolinhasAtuais));

    for (let i = 0; i < niveisBolinha.length; i++) {
      niveisBolinha[i] = lerp(niveisBolinha[i], 0, 0.18);
    }
  }

  const passo = width / Math.max(1, numBolinhasAtuais);
  const diametroMaximoVisivel = Math.min(DIAMETRO_MAX, passo - ESPACO_BOLINHAS);
  const centroY = height / 2;

  noStroke();
  fill(COR_RUC);

  for (let i = 0; i < numBolinhasAtuais; i++) {
    const alvo = constrain(niveisBolinha[i] || 0, 0, 1);
    const diametro = DIAMETRO_MIN + alvo * (diametroMaximoVisivel - DIAMETRO_MIN);
    const centroX = passo * (i + 0.5);
    circle(centroX, centroY, diametro);
  }
}

// Liga os controlos depois de o p5 criar o canvas. A ausência desta função
// fazia o setup() falhar antes de o botão de importação receber o seu evento.
function ligarInterface() {
  elDropZone = select('#drop-zone');
  elInputAudio = select('#input-audio');
  elBtnImport = select('#btn-import');
  elBtnPlay = select('#btn-play');
  elBtnExport = select('#btn-export');
  elSlider = select('#slider-sensibilidade');
  elStatus = select('#status-texto');

  if (!elInputAudio || !elBtnImport || !elSlider || !elStatus) {
    console.error('Não foi possível inicializar os controlos de áudio.');
    return;
  }

  elBtnImport.mousePressed(() => elInputAudio.elt.click());
  elInputAudio.changed(lidarComInputAudio);

  if (elBtnPlay) {
    elBtnPlay.mousePressed(alternarReproducao);
    elBtnPlay.elt.disabled = true;
  }
  if (elBtnExport) elBtnExport.elt.disabled = true;

  if (elDropZone) {
    elDropZone.elt.addEventListener('dragover', (event) => {
      event.preventDefault();
      elDropZone.elt.classList.add('drag-over');
    });
    elDropZone.elt.addEventListener('dragleave', (event) => {
      if (!elDropZone.elt.contains(event.relatedTarget)) {
        elDropZone.elt.classList.remove('drag-over');
      }
    });
    elDropZone.elt.addEventListener('drop', (event) => {
      event.preventDefault();
      elDropZone.elt.classList.remove('drag-over');
      const ficheiro = event.dataTransfer && event.dataTransfer.files[0];
      if (ficheiro) carregarFicheiroAudio(ficheiro);
    });
  }
}

function lidarComInputAudio() {
  const ficheiro = elInputAudio && elInputAudio.elt.files[0];
  if (ficheiro) carregarFicheiroAudio(ficheiro);
}

async function carregarFicheiroAudio(ficheiro) {
  if (!ficheiro) return;

  if (sourceNode) {
    paragemManual = true;
    sourceNode.onended = null;
    sourceNode.stop();
    sourceNode = null;
  }
  estaTocando = false;
  offsetPausa = 0;
  if (elBtnPlay) elBtnPlay.html('Tocar / Pausa');
  atualizarEstado(`A carregar ${ficheiro.name}…`);

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Este navegador não suporta áudio Web Audio.');
    if (!audioCtx) audioCtx = new AudioContextClass();

    const bytes = await ficheiro.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(bytes);

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    dadosTempo = new Uint8Array(analyserNode.fftSize);
    dadosFrequencia = new Float32Array(analyserNode.frequencyBinCount);

    nomeFicheiroBase = ficheiro.name.replace(/\.[^.]+$/, '') || 'waveform-ruc';
    if (elBtnPlay) elBtnPlay.elt.disabled = false;
    atualizarEstado(`Áudio carregado: ${ficheiro.name}. Carrega em “Tocar / Pausa” para pré-visualizar a waveform.`);
  } catch (erro) {
    audioBuffer = null;
    if (elBtnPlay) elBtnPlay.elt.disabled = true;
    atualizarEstado(`Não foi possível importar o áudio: ${erro.message || erro}`);
    console.error('Erro ao importar áudio:', erro);
  }
}

async function alternarReproducao() {
  if (!audioBuffer || !audioCtx) return;

  try {
    await audioCtx.resume();
    if (estaTocando) {
      offsetPausa = Math.min(audioBuffer.duration, offsetPausa + audioCtx.currentTime - tempoInicioCtx);
      const fonte = sourceNode;
      sourceNode = null;
      estaTocando = false;
      paragemManual = true;
      if (fonte) fonte.stop();
      if (elBtnPlay) elBtnPlay.html('Tocar / Pausa');
      atualizarEstado('Reprodução em pausa.');
      return;
    }

    if (offsetPausa >= audioBuffer.duration) offsetPausa = 0;
    const fonte = audioCtx.createBufferSource();
    fonte.buffer = audioBuffer;
    fonte.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
    sourceNode = fonte;
    estaTocando = true;
    paragemManual = false;
    tempoInicioCtx = audioCtx.currentTime;
    fonte.onended = () => {
      if (sourceNode !== fonte) return;
      sourceNode = null;
      estaTocando = false;
      offsetPausa = 0;
      if (elBtnPlay) elBtnPlay.html('Tocar / Pausa');
      atualizarEstado('Reprodução terminada. Carrega em “Tocar / Pausa” para ouvir novamente.');
    };
    fonte.start(0, offsetPausa);
    if (elBtnPlay) elBtnPlay.html('Pausa');
    atualizarEstado('A reproduzir áudio.');
  } catch (erro) {
    atualizarEstado(`Não foi possível reproduzir o áudio: ${erro.message || erro}`);
    console.error('Erro na reprodução:', erro);
  }
}

function atualizarEstado(mensagem) {
  if (elStatus) elStatus.elt.textContent = mensagem;
}
