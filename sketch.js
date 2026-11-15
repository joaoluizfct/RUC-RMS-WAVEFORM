let audioCtx = null;
let audioBuffer = null;
let sourceNode = null;
let analyserNode = null;
let dadosTempo = null;
let streamDest = null;
let ultimoUrlExportado = null;
let ultimoUrlImagem = null;
let nomeFicheiroBase = 'post-ruc';

let imagemFundo = null;

let estaTocando = false;
let tempoInicioCtx = 0;
let offsetPausa = 0;
let paragemManual = false;

// Dimensões do Post 4x5 e coordenadas exatas do Figma (X: 60, Y: 1226, W: 420, H: 84)
const LARGURA_POST = 1080;
const ALTURA_POST = 1350;
const WAVE_X = 60;
const WAVE_Y = 1226;
const WAVE_W = 420;
const WAVE_H = 84;

const NUM_BOLINHAS = 19;
const DIAMETRO_MIN = 5;
const DIAMETRO_MAX = 32;
const COR_RUC = '#E31E24';

// Linha fixa: os centros das 19 bolinhas nunca mudam de X, apenas o raio cresce
const MARGEM_X = DIAMETRO_MAX / 2;
const LARGURA_LINHA_FIXA = WAVE_W - MARGEM_X * 2;
const PASSO_FIXO = LARGURA_LINHA_FIXA / (NUM_BOLINHAS - 1);

let mapaRMSEstatico = Array.from({ length: NUM_BOLINHAS }, () => 0);
let diametrosAtuais = Array.from({ length: NUM_BOLINHAS }, () => DIAMETRO_MIN);
let rmsSuave = 0;

let gravando = false;
let mediaRecorder = null;
let chunksGravacao = [];

let elDropZone, elInputImg, elInputAudio, elBtnImportImg, elBtnImportAudio, elBtnPlay, elBtnExport, elSlider, elStatus;

function setup() {
  let cnv = createCanvas(LARGURA_POST, ALTURA_POST);
  cnv.parent('canvas-wrapper');
  pixelDensity(1);
  ligarInterface();
}

function draw() {
  // 1. Camada de fundo (PNG exportado do Figma ou guia visual enquanto não é carregado)
  if (imagemFundo) {
    background(0);
    image(imagemFundo, 0, 0, width, height);
  } else {
    desenharGuiaSemImagem();
  }

  // 2. Cálculo da energia RMS da voz
  const sensibilidade = elSlider ? parseFloat(elSlider.value()) : 1.3;
  let rmsInst = 0;
  let progressoAudio = 0;

  if (estaTocando && audioBuffer && analyserNode && dadosTempo) {
    const tempoDecorrido = offsetPausa + (audioCtx.currentTime - tempoInicioCtx);
    progressoAudio = constrain(tempoDecorrido / audioBuffer.duration, 0, 1);

    analyserNode.getByteTimeDomainData(dadosTempo);
    let somaQuadrados = 0;
    for (const amostra of dadosTempo) {
      const normalizado = (amostra - 128) / 128;
      somaQuadrados += normalizado * normalizado;
    }

    const rmsBruto = sqrt(somaQuadrados / dadosTempo.length);
    rmsInst = constrain(pow(rmsBruto * 3.5 * sensibilidade, 0.85), 0, 1);
  }

  const fatorSuavizacao = rmsInst > rmsSuave ? 0.55 : 0.22;
  rmsSuave = lerp(rmsSuave, rmsInst, fatorSuavizacao);

  // 3. Desenho das 19 bolinhas ancoradas na posição X:60, Y:1226
  const centroY = WAVE_Y + WAVE_H / 2;
  noStroke();
  fill(COR_RUC);

  for (let i = 0; i < NUM_BOLINHAS; i++) {
    const posNorm = i / (NUM_BOLINHAS - 1);
    const baseRMS = mapaRMSEstatico[i] || 0;
    let intensidadeAlvo = 0;

    if (!audioBuffer) {
      intensidadeAlvo = pow(sin(posNorm * PI), 1.4) * 0.14;
    } else if (!estaTocando) {
      intensidadeAlvo = baseRMS * 0.45;
    } else {
      const distCursor = abs(posNorm - progressoAudio);
      const realceCursor = exp(-pow(distCursor / 0.14, 2));
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

    const centroX = WAVE_X + MARGEM_X + i * PASSO_FIXO;
    circle(centroX, centroY, diametrosAtuais[i]);
  }
}

function desenharGuiaSemImagem() {
  background('#18181b');

  // Marcação subtil da área da waveform (X:60, Y:1226, 420x84)
  noFill();
  stroke(255, 255, 255, 45);
  strokeWeight(2);
  rect(WAVE_X, WAVE_Y, WAVE_W, WAVE_H, 8);

  noStroke();
  fill(255, 255, 255, 160);
  textAlign(CENTER, CENTER);
  textFont('Inter, sans-serif');
  textSize(28);
  text('Pré-visualização do Post (1080 × 1350)', width / 2, height / 2 - 20);
  textSize(20);
  fill(255, 255, 255, 100);
  text('Importa o PNG do Figma para preencher o fundo', width / 2, height / 2 + 22);
}

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
  elInputImg = select('#input-imagem');
  elInputAudio = select('#input-audio');
  elBtnImportImg = select('#btn-import-img');
  elBtnImportAudio = select('#btn-import-audio');
  elBtnPlay = select('#btn-play');
  elBtnExport = select('#btn-export');
  elSlider = select('#slider-sensibilidade');
  elStatus = select('#status-texto');

  elBtnImportImg.mousePressed(() => {
    elInputImg.elt.value = '';
    elInputImg.elt.click();
  });
  elInputImg.changed(() => {
    const ficheiro = elInputImg.elt.files[0];
    if (ficheiro) carregarFicheiroImagem(ficheiro);
  });

  elBtnImportAudio.mousePressed(() => {
    elInputAudio.elt.value = '';
    elInputAudio.elt.click();
  });
  elInputAudio.changed(() => {
    const ficheiro = elInputAudio.elt.files[0];
    if (ficheiro) carregarFicheiroAudio(ficheiro);
  });

  elBtnPlay.mousePressed(alternarReproducao);
  elBtnExport.mousePressed(iniciarExportacao);

  // Suporte para arrastar PNG e Áudio ao mesmo tempo ou em separado
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
    if (!event.dataTransfer || !event.dataTransfer.files) return;

    Array.from(event.dataTransfer.files).forEach((ficheiro) => {
      if (ficheiro.type.startsWith('image/')) {
        carregarFicheiroImagem(ficheiro);
      } else if (
        ficheiro.type.startsWith('audio/') ||
        /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(ficheiro.name)
      ) {
        carregarFicheiroAudio(ficheiro);
      }
    });
  });
}

function carregarFicheiroImagem(ficheiro) {
  const urlTemp = URL.createObjectURL(ficheiro);
  atualizarEstado(`A carregar imagem ${ficheiro.name}…`);

  loadImage(
    urlTemp,
    (img) => {
      if (ultimoUrlImagem) URL.revokeObjectURL(ultimoUrlImagem);
      ultimoUrlImagem = urlTemp;
      imagemFundo = img;

      if (!audioBuffer) {
        nomeFicheiroBase = ficheiro.name
          .replace(/\.[^.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, '-') || 'post-ruc';
      }

      atualizarEstado(
        audioBuffer
          ? `Pronto para exportar! Imagem e áudio carregados.`
          : `Imagem carregada (${img.width}×${img.height}px). Agora importa o áudio.`
      );
    },
    () => {
      URL.revokeObjectURL(urlTemp);
      atualizarEstado('Não foi possível ler a imagem. Usa um ficheiro PNG ou JPG válido.');
    }
  );
}

async function carregarFicheiroAudio(ficheiro) {
  if (sourceNode) {
    paragemManual = true;
    sourceNode.onended = null;
    try { sourceNode.stop(); } catch (e) {}
    sourceNode = null;
  }
  estaTocando = false;
  offsetPausa = 0;
  rmsSuave = 0;

  elBtnPlay.html('Tocar / Pausa');
  elBtnExport.elt.disabled = true;
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
      .replace(/[^a-z0-9-_]+/g, '-') || 'post-ruc';

    elBtnPlay.elt.disabled = false;
    elBtnExport.elt.disabled = false;

    atualizarEstado(
      imagemFundo
        ? `Pronto para exportar! Áudio: ${ficheiro.name} (${audioBuffer.duration.toFixed(1)}s).`
        : `Áudio carregado (${audioBuffer.duration.toFixed(1)}s). Importa também o PNG do post.`
    );
  } catch (erro) {
    audioBuffer = null;
    elBtnPlay.elt.disabled = true;
    elBtnExport.elt.disabled = true;
    atualizarEstado(`Erro ao importar áudio: ${erro.message || erro}`);
    console.error(erro);
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
      elBtnPlay.html('Tocar / Pausa');
      atualizarEstado('Reprodução em pausa.');
      return;
    }

    if (offsetPausa >= audioBuffer.duration) offsetPausa = 0;
    iniciarFonteAudio(offsetPausa, false);

    elBtnPlay.html('Pausa');
    atualizarEstado('A reproduzir pré-visualização.');
  } catch (erro) {
    atualizarEstado(`Erro na reprodução: ${erro.message || erro}`);
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
    elBtnPlay.html('Tocar / Pausa');

    if (gravando) {
      finalizarExportacao();
    } else {
      atualizarEstado('Reprodução terminada.');
    }
  };

  fonte.start(0, inicioSegundos);
}

function escolherFormatoVideo() {
  const candidatos = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' }
  ];

  for (const item of candidatos) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(item.mime)) {
      return item;
    }
  }
  return { mime: '', ext: 'webm' };
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

    elBtnImportImg.elt.disabled = true;
    elBtnImportAudio.elt.disabled = true;
    elBtnPlay.elt.disabled = true;
    elBtnExport.elt.disabled = true;

    const formato = escolherFormatoVideo();
    atualizarEstado(`A gravar vídeo final (${formato.ext.toUpperCase()} 1080×1350)… Aguarda o fim do áudio.`);

    const canvasEl = document.querySelector('#canvas-wrapper canvas');
    const canvasStream = canvasEl.captureStream(60);
    streamDest = audioCtx.createMediaStreamDestination();

    const streamFinal = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...streamDest.stream.getAudioTracks()
    ]);

    const opcoes = { videoBitsPerSecond: 8000000 };
    if (formato.mime) opcoes.mimeType = formato.mime;

    mediaRecorder = new MediaRecorder(streamFinal, opcoes);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksGravacao.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const nomeSaida = `${nomeFicheiroBase}-post.${formato.ext}`;
      const tipoBlob = formato.mime || `video/${formato.ext}`;
      const blob = new Blob(chunksGravacao, { type: tipoBlob });
      ultimoUrlExportado = URL.createObjectURL(blob);

      const linkAuto = document.createElement('a');
      linkAuto.href = ultimoUrlExportado;
      linkAuto.download = nomeSaida;
      linkAuto.click();

      elStatus.elt.innerHTML = `Concluído! Ficheiro transferido: <a href="${ultimoUrlExportado}" download="${nomeSaida}">${nomeSaida}</a>`;

      gravando = false;
      streamDest = null;
      elBtnImportImg.elt.disabled = false;
      elBtnImportAudio.elt.disabled = false;
      elBtnPlay.elt.disabled = false;
      elBtnExport.elt.disabled = false;
    };

    mediaRecorder.start();
    iniciarFonteAudio(0, true);
  } catch (erro) {
    gravando = false;
    elBtnImportImg.elt.disabled = false;
    elBtnImportAudio.elt.disabled = false;
    elBtnPlay.elt.disabled = false;
    elBtnExport.elt.disabled = false;
    atualizarEstado(`Erro ao exportar: ${erro.message || erro}`);
    console.error(erro);
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
