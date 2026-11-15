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

// Especificações exatas do Figma (420 × 84 px, 19 bolinhas, 5x5 a 32x32, gap 6)
const LARGURA_FRAME = 420;
const ALTURA_FRAME = 84;
const LARGURA_MAX_UTIL = 414;
const NUM_BOLINHAS = 19;
const ESPACO_BOLINHAS = 6;
const DIAMETRO_MIN = 5;
const DIAMETRO_MAX = 32;
const COR_RUC = '#E31E24';

let diametrosAtuais = Array.from({ length: NUM_BOLINHAS }, () => DIAMETRO_MIN);
let graveSuave = 0;
let medioSuave = 0;
let agudoSuave = 0;
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
  let graveInst = 0;
  let medioInst = 0;
  let agudoInst = 0;

  if (estaTocando && audioBuffer && analyserNode && dadosTempo && dadosFrequencia) {
    analyserNode.getByteTimeDomainData(dadosTempo);
    analyserNode.getFloatFrequencyData(dadosFrequencia);

    // 1. Energia global da voz (RMS)
    let somaQuadrados = 0;
    for (const amostra of dadosTempo) {
      const norm = (amostra - 128) / 128;
      somaQuadrados += norm * norm;
    }
    const rmsBruto = sqrt(somaQuadrados / dadosTempo.length);
    rmsInst = constrain(pow(rmsBruto * 3.4 * sensibilidade, 0.85), 0, 1);

    // 2. Três bandas vocais para esculpir múltiplas cristas ao longo das 19 bolinhas
    graveInst = lerEnergiaBanda(85, 280, sensibilidade);     // corpo da voz (pico central)
    medioInst = lerEnergiaBanda(300, 1400, sensibilidade);   // vogais/formantes (crista intermédia)
    agudoInst = lerEnergiaBanda(1600, 6500, sensibilidade);  // consoantes/ataque (crista direita)
  }

  // Ataque rápido na fala, decaimento fluido nas pausas
  rmsSuave = lerp(rmsSuave, rmsInst, rmsInst > rmsSuave ? 0.52 : 0.2);
  graveSuave = lerp(graveSuave, graveInst, graveInst > graveSuave ? 0.48 : 0.18);
  medioSuave = lerp(medioSuave, medioInst, medioInst > medioSuave ? 0.55 : 0.22);
  agudoSuave = lerp(agudoSuave, agudoInst, agudoInst > agudoSuave ? 0.6 : 0.25);

  const tempo = millis() * 0.004;

  // Calcula a intensidade bruta de cada uma das 19 posições
  const intensidadesBrutas = Array.from({ length: NUM_BOLINHAS }, (_, i) => {
    const posNorm = i / (NUM_BOLINHAS - 1); // 0.0 (esquerda) -> 1.0 (direita)

    // Envelope base de gradação (pontas sempre afiladas em 5px, centro encorpado)
    const arcoBase = pow(sin(posNorm * PI), 1.35);

    if (!estaTocando) {
      // Estado em repouso/pausa: curva simétrica suave (5px nas pontas -> ~18px no centro)
      return arcoBase * 0.42;
    }

    // Crista 1 (Principal): oscila organicamente em torno do centro (índices 7 a 10)
    const centroPico1 = 0.46 + sin(tempo * 1.1) * 0.04 * medioSuave;
    const pico1 = exp(-pow((posNorm - centroPico1) / 0.21, 2)) * (0.25 + 0.85 * max(rmsSuave, graveSuave));

    // Crista 2 (Secundária): surge nas sílabas/vogais (índices 11 a 14) criando vale intermédio
    const centroPico2 = 0.68 + cos(tempo * 1.6) * 0.03;
    const pico2 = exp(-pow((posNorm - centroPico2) / 0.11, 2)) * medioSuave * 0.88;

    // Crista 3 (Acento agudo): surge nas consoantes/ênfase (índices 15 a 17, antes da ponta de 5px)
    const centroPico3 = 0.86;
    const pico3 = exp(-pow((posNorm - centroPico3) / 0.075, 2)) * agudoSuave * 0.85;

    // Combina as cristas respeitando o afilamento das pontas
    const ondaCombinada = max(pico1, max(pico2, pico3));
    const mascaraPontas = lerp(0.0, 1.0, pow(sin(posNorm * PI), 0.55));

    return constrain(ondaCombinada * mascaraPontas, 0, 1);
  });

  // Aplica gradação espacial entre vizinhas para manter "semelhança de família"
  const intensidadesGradadas = intensidadesBrutas.map((val, i, arr) => {
    if (i === 0 || i === NUM_BOLINHAS - 1) return 0; // extremidades fixas em 5x5 px
    const ant = arr[i - 1];
    const prox = arr[i + 1];
    return ant * 0.18 + val * 0.64 + prox * 0.18;
  });

  // Atualiza diâmetros finais (5px a 32px)
  diametrosAtuais = diametrosAtuais.map((dAtual, i) => {
    const dAlvo = lerp(DIAMETRO_MIN, DIAMETRO_MAX, intensidadesGradadas[i]);
    return constrain(lerp(dAtual, dAlvo, 0.45), DIAMETRO_MIN, DIAMETRO_MAX);
  });

  // Posiciona em Auto Layout horizontal com 6px exatos entre bordas
  const somaDiametros = diametrosAtuais.reduce((acc, d) => acc + d, 0);
  const larguraTotalIdeal = somaDiametros + (NUM_BOLINHAS - 1) * ESPACO_BOLINHAS;

  const escalaX = larguraTotalIdeal > LARGURA_MAX_UTIL ? LARGURA_MAX_UTIL / larguraTotalIdeal : 1;
  const gapEfetivo = ESPACO_BOLINHAS * escalaX;
  const larguraFinal = larguraTotalIdeal * escalaX;

  let cursorX = (width - larguraFinal) / 2;
  const centroY = height / 2;

  noStroke();
  fill(COR_RUC);

  for (let i = 0; i < NUM_BOLINHAS; i++) {
    const dDesenho = diametrosAtuais[i] * escalaX;
    const centroX = cursorX + dDesenho / 2;
    circle(centroX, centroY, dDesenho);
    cursorX += dDesenho + gapEfetivo;
  }
}

function lerEnergiaBanda(freqMin, freqMax, sensibilidade) {
  if (!dadosFrequencia || !audioCtx || !analyserNode) return 0;

  const nyquist = audioCtx.sampleRate / 2;
  const binInicio = Math.max(1, Math.floor((freqMin / nyquist) * dadosFrequencia.length));
  const binFim = Math.min(dadosFrequencia.length - 1, Math.ceil((freqMax / nyquist) * dadosFrequencia.length));

  let somaPotencia = 0;
  let contagem = 0;

  for (let bin = binInicio; bin <= binFim; bin++) {
    const db = dadosFrequencia[bin];
    if (Number.isFinite(db)) {
      const amp = Math.pow(10, db / 20);
      somaPotencia += amp * amp;
      contagem++;
    }
  }

  if (contagem === 0) return 0;
  const rmsBanda = Math.sqrt(somaPotencia / contagem);
  const dbBanda = 20 * Math.log10(Math.max(rmsBanda, 0.000001));
  const norm = constrain((dbBanda + 58) / 36, 0, 1);
  return constrain(pow(norm, 0.85) * sensibilidade, 0, 1);
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

  if (elBtnPlay) elBtnPlay.html('Tocar / Pausa');
  if (elBtnExport) elBtnExport.elt.disabled = true;
  atualizarEstado(`A carregar ${ficheiro.name}…`);

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Este navegador não suporta Web Audio.');
    if (!audioCtx) audioCtx = new AudioContextClass();

    const bytes = await ficheiro.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(bytes);

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.connect(audioCtx.destination);
    dadosTempo = new Uint8Array(analyserNode.fftSize);
    dadosFrequencia = new Float32Array(analyserNode.frequencyBinCount);

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
      offsetPausa = Math.min(audioBuffer.duration, offsetPausa + audioCtx.currentTime - tempoInicioCtx);
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
