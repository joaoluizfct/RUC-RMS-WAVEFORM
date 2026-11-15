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

// Formatos independentes: mesma waveform (420×84, 19 bolinhas), coordenadas diferentes
const FORMATOS = {
  post: {
    largura: 1080,
    altura: 1350,
    waveX: 60,
    waveY: 1226,
    label: 'POST 4:5 · 1080 × 1350 PX · WAVEFORM (60, 1226)'
  },
  story: {
    largura: 1080,
    altura: 1920,
    waveX: 60,
    waveY: 1633,
    label: 'STORY 9:16 · 1080 × 1920 PX · WAVEFORM (60, 1633)'
  }
};

const CORES_RUC = {
  vermelho: '#C53030',
  branco: '#F7F6ED'
};

let formatoAtual = 'post';
let formatoEscolhidoManualmente = false;
let corAtual = CORES_RUC.vermelho;
let extensaoEscolhida = 'mp4';

// Especificações fixas da waveform (420 × 84 px, 19 bolinhas, 5×5 a 32×32 px)
const WAVE_W = 420;
const WAVE_H = 84;
const NUM_BOLINHAS = 19;
const DIAMETRO_MIN = 5;
const DIAMETRO_MAX = 32;

const MARGEM_X = DIAMETRO_MAX / 2;
const LARGURA_LINHA_FIXA = WAVE_W - MARGEM_X * 2;
const PASSO_FIXO = LARGURA_LINHA_FIXA / (NUM_BOLINHAS - 1);

let mapaRMSEstatico = Array.from({ length: NUM_BOLINHAS }, () => 0);
let diametrosAtuais = Array.from({ length: NUM_BOLINHAS }, () => DIAMETRO_MIN);
let rmsSuave = 0;

let gravando = false;
let mediaRecorder = null;
let chunksGravacao = [];

// Referências DOM
let elDropZone, elCanvasWrapper, elStageMeta;
let elInputImg, elInputAudio, elBtnImportImg, elBtnImportAudio;
let elBtnFmtPost, elBtnFmtStory, elBtnCorVermelho, elBtnCorBranco;
let elBtnExtMp4, elBtnExtMov, elBtnPlay, elBtnExport;
let elSlider, elSliderVal, elStatus, elPlayerTime, elCodecInfo;

function setup() {
  const cfg = FORMATOS[formatoAtual];
  let cnv = createCanvas(cfg.largura, cfg.altura);
  cnv.parent('canvas-wrapper');
  pixelDensity(1);
  ligarInterface();
}

function draw() {
  const cfg = FORMATOS[formatoAtual];

  // Garante que o buffer interno do canvas acompanha sempre o formato ativo (1080×1350 ou 1080×1920)
  if (width !== cfg.largura || height !== cfg.altura) {
    resizeCanvas(cfg.largura, cfg.altura);
    pixelDensity(1);
  }

  // 1. Fundo (PNG do Figma ou guia visual)
  if (imagemFundo) {
    background('#121212');
    image(imagemFundo, 0, 0, width, height);
  } else {
    desenharGuiaSemImagem(cfg);
  }

  // 2. Leitura RMS da voz e atualização do tempo
  const sensibilidade = elSlider ? parseFloat(elSlider.value()) : 1.3;
  let rmsInst = 0;
  let progressoAudio = 0;
  let tempoAtual = offsetPausa;

  if (estaTocando && audioBuffer && analyserNode && dadosTempo) {
    tempoAtual = constrain(offsetPausa + (audioCtx.currentTime - tempoInicioCtx), 0, audioBuffer.duration);
    progressoAudio = constrain(tempoAtual / audioBuffer.duration, 0, 1);

    analyserNode.getByteTimeDomainData(dadosTempo);
    let somaQuadrados = 0;
    for (const amostra of dadosTempo) {
      const normalizado = (amostra - 128) / 128;
      somaQuadrados += normalizado * normalizado;
    }

    const rmsBruto = sqrt(somaQuadrados / dadosTempo.length);
    rmsInst = constrain(pow(rmsBruto * 3.5 * sensibilidade, 0.85), 0, 1);
  }

  atualizarTempoUI(tempoAtual, audioBuffer ? audioBuffer.duration : 0);

  const fatorSuavizacao = rmsInst > rmsSuave ? 0.55 : 0.22;
  rmsSuave = lerp(rmsSuave, rmsInst, fatorSuavizacao);

  // 3. Desenho das 19 bolinhas fixas nas coordenadas exatas do formato ativo
  const centroY = cfg.waveY + WAVE_H / 2;
  noStroke();
  fill(corAtual);

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

    const centroX = cfg.waveX + MARGEM_X + i * PASSO_FIXO;
    circle(centroX, centroY, diametrosAtuais[i]);
  }
}

function desenharGuiaSemImagem(cfg) {
  background('#141414');

  stroke(255, 255, 255, 14);
  strokeWeight(1);
  line(60, 0, 60, height);
  line(width - 60, 0, width - 60, height);

  noFill();
  stroke(255, 255, 255, 65);
  strokeWeight(2);
  rect(cfg.waveX, cfg.waveY, WAVE_W, WAVE_H);

  noStroke();
  fill('#F7F6ED');
  textAlign(CENTER, CENTER);
  textFont('Oswald, sans-serif');
  textSize(38);
  text(
    formatoAtual === 'story' ? 'STORY 9:16 (1080 × 1920)' : 'POST FEED 4:5 (1080 × 1350)',
    width / 2,
    height / 2 - 22
  );

  textFont('Syne, sans-serif');
  textSize(19);
  fill('#9A9A95');
  text('Importa o PNG exportado do Figma para preencher o fundo', width / 2, height / 2 + 24);
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
  elDropZone = document.getElementById('drop-zone');
  elCanvasWrapper = document.getElementById('canvas-wrapper');
  elStageMeta = document.getElementById('stage-meta');

  elInputImg = document.getElementById('input-imagem');
  elInputAudio = document.getElementById('input-audio');
  elBtnImportImg = document.getElementById('btn-import-img');
  elBtnImportAudio = document.getElementById('btn-import-audio');

  elBtnFmtPost = document.getElementById('btn-fmt-post');
  elBtnFmtStory = document.getElementById('btn-fmt-story');

  elBtnCorVermelho = document.getElementById('btn-cor-vermelho');
  elBtnCorBranco = document.getElementById('btn-cor-branco');

  elBtnExtMp4 = document.getElementById('btn-ext-mp4');
  elBtnExtMov = document.getElementById('btn-ext-mov');

  elBtnPlay = document.getElementById('btn-play');
  elBtnExport = document.getElementById('btn-export');
  elSlider = document.getElementById('slider-sensibilidade');
  elSliderVal = document.getElementById('slider-val');
  elStatus = document.getElementById('status-texto');
  elPlayerTime = document.getElementById('player-time');
  elCodecInfo = document.getElementById('codec-info');

  elBtnImportImg.addEventListener('click', () => {
    if (gravando) return;
    elInputImg.value = '';
    elInputImg.click();
  });
  elInputImg.addEventListener('change', () => {
    if (elInputImg.files[0]) carregarFicheiroImagem(elInputImg.files[0]);
  });

  elBtnImportAudio.addEventListener('click', () => {
    if (gravando) return;
    elInputAudio.value = '';
    elInputAudio.click();
  });
  elInputAudio.addEventListener('change', () => {
    if (elInputAudio.files[0]) carregarFicheiroAudio(elInputAudio.files[0]);
  });

  elBtnFmtPost.addEventListener('click', () => {
    formatoEscolhidoManualmente = true;
    alterarFormato('post');
  });

  elBtnFmtStory.addEventListener('click', () => {
    formatoEscolhidoManualmente = true;
    alterarFormato('story');
  });

  elBtnCorVermelho.addEventListener('click', () => {
    corAtual = CORES_RUC.vermelho;
    elBtnCorVermelho.classList.add('active');
    elBtnCorBranco.classList.remove('active');
  });

  elBtnCorBranco.addEventListener('click', () => {
    corAtual = CORES_RUC.branco;
    elBtnCorBranco.classList.add('active');
    elBtnCorVermelho.classList.remove('active');
  });

  elBtnExtMp4.addEventListener('click', () => {
    extensaoEscolhida = 'mp4';
    elBtnExtMp4.classList.add('active');
    elBtnExtMov.classList.remove('active');
  });

  elBtnExtMov.addEventListener('click', () => {
    extensaoEscolhida = 'mov';
    elBtnExtMov.classList.add('active');
    elBtnExtMp4.classList.remove('active');
  });

  elSlider.addEventListener('input', () => {
    elSliderVal.textContent = `${parseFloat(elSlider.value).toFixed(2)}×`;
  });

  elBtnPlay.addEventListener('click', alternarReproducao);
  elBtnExport.addEventListener('click', iniciarExportacao);

  elDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elDropZone.classList.add('drag-over');
  });

  elDropZone.addEventListener('dragleave', (e) => {
    if (!elDropZone.contains(e.relatedTarget)) {
      elDropZone.classList.remove('drag-over');
    }
  });

  elDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elDropZone.classList.remove('drag-over');
    if (gravando || !e.dataTransfer || !e.dataTransfer.files) return;

    Array.from(e.dataTransfer.files).forEach((ficheiro) => {
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

  const fmtDetetado = escolherFormatoVideo();
  if (fmtDetetado.suportaH264) {
    elCodecInfo.textContent = 'Codec H.264 + AAC ativo (compatível com iPhone/iOS, QuickTime e PC).';
  } else {
    elCodecInfo.textContent = 'Aviso: este navegador não expõe H.264; usa Chrome, Edge ou Safari para compatibilidade iOS.';
  }
}

function alterarFormato(novoFormato) {
  if (gravando) return;
  formatoAtual = novoFormato;
  const cfg = FORMATOS[formatoAtual];

  if (elStageMeta) elStageMeta.textContent = cfg.label;

  if (formatoAtual === 'story') {
    if (elCanvasWrapper) elCanvasWrapper.classList.add('is-story');
    if (elBtnFmtStory) elBtnFmtStory.classList.add('active');
    if (elBtnFmtPost) elBtnFmtPost.classList.remove('active');
  } else {
    if (elCanvasWrapper) elCanvasWrapper.classList.remove('is-story');
    if (elBtnFmtPost) elBtnFmtPost.classList.add('active');
    if (elBtnFmtStory) elBtnFmtStory.classList.remove('active');
  }

  resizeCanvas(cfg.largura, cfg.altura);
  pixelDensity(1);
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

      // Deteta automaticamente Story (9:16) vs Post (4:5) apenas se o utilizador não tiver forçado um formato antes
      if (!formatoEscolhidoManualmente && img.width > 0 && img.height > 0) {
        if (img.height / img.width >= 1.55) {
          alterarFormato('story');
        } else {
          alterarFormato('post');
        }
      }

      if (!audioBuffer) {
        nomeFicheiroBase = ficheiro.name
          .replace(/\.[^.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, '-') || 'ruc-post';
      }

      atualizarEstado(
        audioBuffer
          ? `Pronto para exportar (${img.width}×${img.height}px + áudio carregado).`
          : `Imagem carregada (${img.width}×${img.height}px). Importa agora o áudio.`
      );
    },
    () => {
      URL.revokeObjectURL(urlTemp);
      atualizarEstado('Não foi possível ler a imagem. Usa um PNG ou JPG válido.');
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

  elBtnPlay.textContent = '▶ Tocar';
  elBtnExport.disabled = true;
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
      .replace(/[^a-z0-9-_]+/g, '-') || 'ruc-post';

    elBtnPlay.disabled = false;
    elBtnExport.disabled = false;
    atualizarTempoUI(0, audioBuffer.duration);

    atualizarEstado(
      imagemFundo
        ? `Pronto: ${ficheiro.name} (${formatarSegundos(audioBuffer.duration)}).`
        : `Áudio carregado (${formatarSegundos(audioBuffer.duration)}). Importa também o PNG do layout.`
    );
  } catch (erro) {
    audioBuffer = null;
    elBtnPlay.disabled = true;
    elBtnExport.disabled = true;
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
      elBtnPlay.textContent = '▶ Tocar';
      atualizarEstado('Reprodução em pausa.');
      return;
    }

    if (offsetPausa >= audioBuffer.duration) offsetPausa = 0;
    iniciarFonteAudio(offsetPausa, false);

    elBtnPlay.textContent = '❚❚ Pausa';
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
    elBtnPlay.textContent = '▶ Tocar';

    if (gravando) {
      finalizarExportacao();
    } else {
      atualizarEstado('Reprodução terminada.');
    }
  };

  fonte.start(0, inicioSegundos);
}

// Prioriza H.264 Level 4.2 (2A) para suportar 1080×1920 a 60fps sem bloquear o MediaRecorder
function escolherFormatoVideo() {
  const candidatosH264 = [
    'video/mp4;codecs=avc1.64002A,mp4a.40.2',
    'video/mp4;codecs=avc1.4D402A,mp4a.40.2',
    'video/mp4;codecs=avc1.42E02A,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4'
  ];

  if (typeof MediaRecorder !== 'undefined') {
    for (const mime of candidatosH264) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return { mime, suportaH264: true };
      }
    }
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
      return { mime: 'video/webm;codecs=vp9,opus', suportaH264: false };
    }
    if (MediaRecorder.isTypeSupported('video/webm')) {
      return { mime: 'video/webm', suportaH264: false };
    }
  }

  return { mime: '', suportaH264: false };
}

function alternarBloqueioUI(bloqueado) {
  elBtnImportImg.disabled = bloqueado;
  elBtnImportAudio.disabled = bloqueado;
  elBtnFmtPost.disabled = bloqueado;
  elBtnFmtStory.disabled = bloqueado;
  elBtnExtMp4.disabled = bloqueado;
  elBtnExtMov.disabled = bloqueado;
  elBtnPlay.disabled = bloqueado;
  elBtnExport.disabled = bloqueado;
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

    const cfg = FORMATOS[formatoAtual];
    if (width !== cfg.largura || height !== cfg.altura) {
      resizeCanvas(cfg.largura, cfg.altura);
      pixelDensity(1);
    }

    offsetPausa = 0;
    rmsSuave = 0;
    gravando = true;
    chunksGravacao = [];

    alternarBloqueioUI(true);

    const formatoVideo = escolherFormatoVideo();
    const extFinal = formatoVideo.suportaH264 ? extensaoEscolhida : 'webm';

    atualizarEstado(`A gravar ${extFinal.toUpperCase()} H.264 (${cfg.largura}×${cfg.altura})… Aguarda o fim do áudio.`);

    const canvasEl = document.querySelector('#canvas-wrapper canvas');
    const canvasStream = canvasEl.captureStream(60);
    streamDest = audioCtx.createMediaStreamDestination();

    const streamFinal = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...streamDest.stream.getAudioTracks()
    ]);

    const opcoes = {
      videoBitsPerSecond: 10000000,
      audioBitsPerSecond: 192000
    };
    if (formatoVideo.mime) opcoes.mimeType = formatoVideo.mime;

    mediaRecorder = new MediaRecorder(streamFinal, opcoes);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksGravacao.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const sufixoFmt = formatoAtual === 'story' ? 'story' : 'post';
      const nomeSaida = `${nomeFicheiroBase}-${sufixoFmt}.${extFinal}`;
      const tipoBlob = formatoVideo.mime || (extFinal === 'mov' ? 'video/quicktime' : 'video/mp4');

      const blob = new Blob(chunksGravacao, { type: tipoBlob });
      ultimoUrlExportado = URL.createObjectURL(blob);

      const linkAuto = document.createElement('a');
      linkAuto.href = ultimoUrlExportado;
      linkAuto.download = nomeSaida;
      linkAuto.click();

      elStatus.innerHTML = `Exportação concluída: <a href="${ultimoUrlExportado}" download="${nomeSaida}">Descarregar ${nomeSaida}</a>`;

      gravando = false;
      streamDest = null;
      alternarBloqueioUI(false);
    };

    mediaRecorder.start(250);
    iniciarFonteAudio(0, true);
  } catch (erro) {
    gravando = false;
    alternarBloqueioUI(false);
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

function formatarSegundos(seg) {
  if (!Number.isFinite(seg) || seg < 0) return '00:00';
  const mins = Math.floor(seg / 60);
  const secs = Math.floor(seg % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function atualizarTempoUI(atual, total) {
  if (elPlayerTime) {
    elPlayerTime.textContent = `${formatarSegundos(atual)} / ${formatarSegundos(total)}`;
  }
}

function atualizarEstado(mensagem) {
  if (elStatus) elStatus.textContent = mensagem;
}
