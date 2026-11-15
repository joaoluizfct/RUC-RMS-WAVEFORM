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
