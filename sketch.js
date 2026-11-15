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

// Especificações fixas: 420 × 84 px, 19 bolinhas ancoradas, 5×5 a 32×32 px
const LARGURA_FRAME = 420;
const ALTURA_FRAME = 84;
const NUM_BOLINHAS = 19;
const DIAMETRO_MIN = 5;
const DIAMETRO_MAX = 32;
const COR_RUC = '#E31E24';

// Margem lateral igual ao raio máximo (16px) para nunca cortar nas bordas da caixa
const MARGEM_X = DIAMETRO_MAX / 2;
const LARGURA_LINHA_FIXA = LARGURA_FRAME - MARGEM_X * 2;
const PASSO_FIXO = LARGURA_LINHA_FIXA / (NUM_BOLINHAS - 1);

let mapaRMSEstatico = Array.from({ length: NUM_BOLINHAS }, () => 0);
let diametrosAtuais = Array.from({ length: NUM_BOLINHAS }, () => DIAMETRO_MIN);
let rmsSuave = 0;

let gravando = false;
let mediaRecorder = null;
let chunksGravacao = [];

let elDropZone, elInputAudio, elBtnImport, elBtnPlay, elBtnExport, elSlider, elStatus;

function setup() {
  let cnv = createCanvas(LARGURA_FRAME, ALTURA_FRAME);
  cnv.parent('canvas-wrapper');
  pixelDensity(1);
  ligarInterface();
}

function draw() {
  clear();

  const sensibilidade = elSlider ? parseFloat(elSlider.value()) : 1.3;
  let rmsInst = 0;
  let progressoAudio = 0;

  if (estaTocando && audioBuffer && analyserNode && dadosTempo) {
    const tempoDecorrido = offsetPausa + (audioCtx.currentTime - tempoInicioCtx);
    progressoAudio = constrain(tempoDecorrido / audioBuffer.duration, 0, 1);

    // Leitura da energia RMS instantânea da voz
    analyserNode.getByteTimeDomainData(dadosTempo);
    let somaQuadrados = 0;
    for (const amostra of dadosTempo) {
      const normalizado = (amostra - 128) / 128;
      somaQuadrados += normalizado * normalizado;
    }

    const rmsBruto = sqrt(somaQuadrados / dadosTempo.length);
    rmsInst = constrain(pow(rmsBruto * 3.5 * sensibilidade, 0.85), 0, 1);
  }

  // Ataque rápido nas sílabas e decaimento fluido nas pausas de fala
  const fatorSuavizacao = rmsInst > rmsSuave ? 0.55 : 0.22;
  rmsSuave = lerp(rmsSuave, rmsInst, fatorSuavizacao);

  const centroY = height / 2;
  noStroke();
  fill(COR_RUC);

  for (let i = 0; i < NUM_BOLINHAS; i++) {
    const posNorm = i / (NUM_BOLINHAS - 1);
    const baseRMS = mapaRMSEstatico[i] || 0;
    let intensidadeAlvo = 0;

    if (!audioBuffer) {
      // Estado inicial sem áudio: leve gradação em repouso
      intensidadeAlvo = pow(sin(posNorm * PI), 1.4) * 0.12;
    } else if (!estaTocando) {
      // Áudio carregado em pausa: mostra a silhueta RMS estática
      intensidadeAlvo = baseRMS * 0.45;
    } else {
      // Durante a reprodução: o RMS vivo dilata as bolinhas no seu eixo fixo
      const distCursor = abs(posNorm - progressoAudio);
      const realceCursor = exp(-pow(distCursor / 0.14, 2));

      // Onda orgânica secundária acoplada ao RMS para dar vida à locução
      const pulsoOrganico = 0.75 + 0.25 * sin(millis() * 0.012 + i * 0.85);

      intensidadeAlvo =
        baseRMS * rmsSuave * pulsoOrganico * 1.15 +
        realceCursor * rmsSuave * 0.35;
    }

    intensidadeAlvo = constrain(intensidadeAlvo, 0, 1);
    const diametroAlvo = lerp(DIAMETRO_MIN, DIAMETRO_MAX, intensidadeAlvo);

    diametrosAtuais[i] = constrain(
      lerp(diametrosAtuais[i], diametroAlvo, 0.42),
      DIAMETRO_MIN,
      DIAMETRO_MAX
    );

    // Posição X estritamente fixa: a largura da linha nunca muda, apenas o raio cresce
    const centroX = MARGEM_X + i * PASSO_FIXO;
    circle(centroX, centroY, diametrosAtuais[i]);
  }
}

// Extrai os 19 valores RMS do ficheiro completo com gradação espacial entre vizinhas
function extrairMapaRMSEstatico(buffer) {
  const numCanais = buffer.numberOfChannels;
  const totalAmostras = buffer.length;
  const tamanhoSegmento = Math.max(1, Math.floor(totalAmostras / NUM_BOLINHAS));

  const canais = Array.from({ length: numCanais }, (_, c) => buffer.getChannelData(c));
  const rmsBrutos = [];

  for (let i = 0; i < NUM_BOLINHAS; i++) {
    const inicio = i * tamanhoSegmento;
    const fim = i === NUM_BOLINHAS - 1 ? totalAmostras : Math.min(totalAmostras, inicio + tamanhoSegmento);
    let somaQuadrados = 0;
    let contagem = 0;

    for (let s = inicio; s < fim; s += 4) {
      let amostraMono = 0;
      for (let c = 0; c < numCanais; c++) {
        amostraMono += canais[c][s];
      }
      amostraMono /= numCanais;
      somaQuadrados += amostraMono * amostraMono;
      contagem++;
    }

    const rms = contagem > 0 ? Math.sqrt(somaQuadrados / contagem) : 0;
    rmsBrutos.push(rms);
  }

  const picoMax = Math.max(...rmsBrutos, 0.0001);
  const normalizados = rmsBrutos.map((v) => Math.pow(v / picoMax, 0.8));

  // Gradação espacial suave (Wucius Wong) para formar agrupamentos orgânicos
  const gradados = normalizados.map((val, i, arr) => {
    const ant = i > 0 ? arr[i - 1] : val;
    const prox = i < arr.length - 1 ? arr[i + 1] : val;
    return ant * 0.2 + val * 0.6 + prox * 0.2;
  });

  const picoGradado = Math.max(...gradados, 0.0001);
  return gradados.map((v) => v / picoGradado);
}

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

  elBtnImport.mousePressed(() => {
    elInputAudio.elt.value = '';
    elInputAudio.elt.click();
  });
  elInputAudio.changed(lidarComInputAudio);

  if (elBtnPlay) {
    elBtnPlay.mousePressed(alternarReproducao);
    elBtnPlay.elt.disabled = true;
  }

  if (elBtnExport) {
    elBtnExport.mousePressed(iniciarExportacao);
    elBtnExport.elt.disabled = true;
  }

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
    try { sourceNode.stop(); } catch (e) {}
    sourceNode = null;
  }
  estaTocando = false;
  offsetPausa = 0;
  rmsSuave = 0;

  if (elBtnPlay) elBtnPlay.html('Tocar / Pausa');
  if (elBtnExport) elBtnExport.elt.disabled = true;
  atualizarEstado(`A analisar RMS de ${ficheiro.name}…`);

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Este navegador não suporta Web Audio.');
    if (!audioCtx) audioCtx = new AudioContextClass();

    const bytes = await ficheiro.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(bytes);

    mapaRMSEstatico = extrairMapaRMSEstatico(audioBuffer);

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.connect(audioCtx.destination);
    dadosTempo = new Uint8Array(analyserNode.fftSize);

    nomeFicheiroBase = ficheiro.name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-') || 'waveform-ruc';

    if (elBtnPlay) elBtnPlay.elt.disabled = false;
    if (elBtnExport) elBtnExport.elt.disabled = false;

    atualizarEstado(`Pronto: ${ficheiro.name} (${audioBuffer.duration.toFixed(1)}s).`);
  } catch (erro) {
    audioBuffer = null;
    if (elBtnPlay) elBtnPlay.elt.disabled = true;
    if (elBtnExport) elBtnExport.elt.disabled = true;
    atualizarEstado(`Não foi possível importar o áudio: ${erro.message || erro}`);
    console.error('Erro ao importar áudio:', erro);
  }
}

async function alternarReproducao() {
  if (!audioBuffer || !audioCtx || gravando) return;

  try {
    await audioCtx.resume();
    if (estaTocando) {
      offsetPausa = Math.min(audioBuffer.duration, offsetPausa + (audioCtx.currentTime - tempoInicioCtx));
      const fonte = sourceNode;
      sourceNode = null;
      estaTocando = false;
      paragemManual = true;
      if (fonte) {
        try { fonte.stop(); } catch (e) {}
      }
      if (elBtnPlay) elBtnPlay.html('Tocar / Pausa');
      atualizarEstado('Reprodução em pausa.');
      return;
    }

    if (offsetPausa >= audioBuffer.duration) offsetPausa = 0;
    iniciarFonteAudio(offsetPausa, false);

    if (elBtnPlay) elBtnPlay.html('Pausa');
    atualizarEstado('A reproduzir áudio.');
  } catch (erro) {
    atualizarEstado(`Não foi possível reproduzir o áudio: ${erro.message || erro}`);
    console.error('Erro na reprodução:', erro);
  }
}

function iniciarFonteAudio(inicioSegundos, paraGravacao) {
  const fonte = audioCtx.createBufferSource();
  fonte.buffer = audioBuffer;
  fonte.connect(analyserNode);

  if (paraGravacao && streamDest) {
    fonte.connect(streamDest);
  }

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

    if (gravando) {
      finalizarExportacao();
    } else {
      atualizarEstado('Reprodução terminada.');
    }
  };

  fonte.start(0, inicioSegundos);
}

async function iniciarExportacao() {
  if (!audioBuffer || !audioCtx || gravando) return;

  try {
    await audioCtx.resume();

    if (sourceNode) {
      paragemManual = true;
      sourceNode.onended = null;
      try { sourceNode.stop(); } catch (e) {}
      sourceNode = null;
    }

    if (ultimoUrlExportado) {
      URL.revokeObjectURL(ultimoUrlExportado);
      ultimoUrlExportado = null;
    }

    offsetPausa = 0;
    rmsSuave = 0;
    gravando = true;
    chunksGravacao = [];

    if (elBtnImport) elBtnImport.elt.disabled = true;
    if (elBtnPlay) elBtnPlay.elt.disabled = true;
    if (elBtnExport) elBtnExport.elt.disabled = true;

    atualizarEstado('A gravar waveform (420×84 transparente)… Aguarda o fim do áudio.');

    const canvasEl = document.querySelector('#canvas-wrapper canvas');
    const canvasStream = canvasEl.captureStream(60);
    streamDest = audioCtx.createMediaStreamDestination();

    const streamFinal = new MediaStream([
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
      const nomeSaida = `${nomeFicheiroBase}-waveform.webm`;
      const blob = new Blob(chunksGravacao, { type: 'video/webm' });
      ultimoUrlExportado = URL.createObjectURL(blob);

      const linkAuto = document.createElement('a');
      linkAuto.href = ultimoUrlExportado;
      linkAuto.download = nomeSaida;
      linkAuto.click();

      if (elStatus) {
        elStatus.elt.innerHTML = `Concluído! Ficheiro transferido: <a href="${ultimoUrlExportado}" download="${nomeSaida}">${nomeSaida}</a>`;
      }

      gravando = false;
      streamDest = null;
      if (elBtnImport) elBtnImport.elt.disabled = false;
      if (elBtnPlay) elBtnPlay.elt.disabled = false;
      if (elBtnExport) elBtnExport.elt.disabled = false;
    };

    mediaRecorder.start();
    iniciarFonteAudio(0, true);
  } catch (erro) {
    gravando = false;
    if (elBtnImport) elBtnImport.elt.disabled = false;
    if (elBtnPlay) elBtnPlay.elt.disabled = false;
    if (elBtnExport) elBtnExport.elt.disabled = false;
    atualizarEstado(`Erro ao exportar: ${erro.message || erro}`);
    console.error('Erro na exportação:', erro);
  }
}

function finalizarExportacao() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    setTimeout(() => {
      mediaRecorder.stop();
    }, 450);
  }
}

function atualizarEstado(mensagem) {
  if (elStatus) elStatus.elt.textContent = mensagem;
}
