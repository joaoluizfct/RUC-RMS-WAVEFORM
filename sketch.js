let audioCtx = null;
let audioBuffer = null;
let sourceNode = null;
let analyserNode = null;
let dadosTempo = null;
let streamDest = null;
let ultimoUrlExportado = null;
let nomeFicheiroBase = 'post-ruc';

let imagemFundo = null;
let interfaceLigada = false;

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
    waveY: 1226
  },
  story: {
    largura: 1080,
    altura: 1920,
    waveX: 60,
    waveY: 1633
  }
};

const CORES_RUC = {
  vermelho: '#C53030',
  branco: '#F7F6ED'
};

let formatoAtual = 'post';
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
let elDropZone, elCanvasWrapper, elCanvasImportTrigger, elCanvasRemoveTrigger;
let elInputImg, elInputAudio, elBtnImportImg, elBtnImportAudio;
let elBtnFmtPost, elBtnFmtStory, elBtnCorVermelho, elBtnCorBranco;
let elBtnExtMp4, elBtnExtMov, elBtnPlay, elBtnExport;
let elSlider, elSensDot, elStatus, elPlayerTime;

function setup() {
  const cfg = FORMATOS[formatoAtual];
  let cnv = createCanvas(cfg.largura, cfg.altura);
  cnv.parent('canvas-wrapper');
  pixelDensity(1);
  ligarInterface();
}

function draw() {
  const cfg = FORMATOS[formatoAtual];

  // 1. Camada de fundo
  if (imagemFundo) {
    background(18, 18, 18);
    desenharImagemProporcional(imagemFundo);
  } else {
    desenharGuiaSemImagem(cfg);
  }

  // 2. Leitura RMS da voz
  const sensibilidade = elSlider ? parseFloat(elSlider.value) : 1.3;
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

  // 3. Desenho das 19 bolinhas fixas
  const centroY = cfg.waveY + WAVE_H / 2;
  noStroke();
  fill(corAtual);

  for (let i = 0; i < NUM_BOLINHAS; i++) {
    const posNorm = i / (NUM_BOLINHAS - 1);
    const baseRMS = mapaRMSEstatico[i] || 0;
    let intensidadeAlvo = 0;

    if (!audioBuffer) {
      intensidadeAlvo = pow(sin(posNorm * PI), 1.4) * 0.25;
    } else if (!estaTocando) {
      intensidadeAlvo = baseRMS * 0.5;
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

function desenharImagemProporcional(img) {
  const imgW = img.width || (img.elt && img.elt.naturalWidth) || width;
  const imgH = img.height || (img.elt && img.elt.naturalHeight) || height;
  if (imgW <= 0 || imgH <= 0) return;

  const escala = Math.max(width / imgW, height / imgH);
  const wFinal = imgW * escala;
  const hFinal = imgH * escala;
  const x = (width - wFinal) / 2;
  const y = (height - hFinal) / 2;

  image(img, x, y, wFinal, hFinal);
}

function desenharGuiaSemImagem(cfg) {
  background(20, 20, 20);

  stroke(255, 255, 255, 16);
  strokeWeight(1);
  line(60, 0, 60, height);
  line(width - 60, 0, width - 60, height);

  noFill();
  stroke(255, 255, 255, 55);
  strokeWeight(2);
  rect(cfg.waveX, cfg.waveY, WAVE_W, WAVE_H);
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

function atualizarIndicadorSensibilidade() {
  if (!elSlider || !elSensDot) return;
  const min = parseFloat(elSlider.min) || 0.5;
  const max = parseFloat(elSlider.max) || 2.5;
  const val = parseFloat(elSlider.value) || 1.3;
  const norm = constrain((val - min) / (max - min), 0, 1);
  const diametro = lerp(DIAMETRO_MIN, DIAMETRO_MAX, norm);

  elSensDot.style.width = `${diametro.toFixed(1)}px`;
  elSensDot.style.height = `${diametro.toFixed(1)}px`;
  elSensDot.style.backgroundColor = corAtual;
}

function ligarInterface() {
  if (interfaceLigada) return;

  elDropZone = document.getElementById('drop-zone');
  elCanvasWrapper = document.getElementById('canvas-wrapper');
  elCanvasImportTrigger = document.getElementById('canvas-import-trigger');
  elCanvasRemoveTrigger = document.getElementById('canvas-remove-trigger');

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
  elSensDot = document.getElementById('sens-dot');
  elStatus = document.getElementById('status-texto');
  elPlayerTime = document.getElementById('player-time');

  interfaceLigada = true;
  atualizarIndicadorSensibilidade();

  const abrirSeletorImagem = () => {
    if (gravando || !elInputImg) return;
    elInputImg.value = '';
    elInputImg.click();
  };

  // Botão Importar Imagem e Ícone Central do Canvas
  elBtnImportImg?.addEventListener('click', abrirSeletorImagem);
  elCanvasImportTrigger?.addEventListener('click', abrirSeletorImagem);

  // Ícone de Lixeira sobre a imagem carregada
  elCanvasRemoveTrigger?.addEventListener('click', removerImagem);

  elInputImg?.addEventListener('change', () => {
    if (elInputImg.files && elInputImg.files[0]) {
      carregarFicheiroImagem(elInputImg.files[0]);
    }
  });

  // Importar Áudio
  elBtnImportAudio?.addEventListener('click', () => {
    if (gravando || !elInputAudio) return;
    elInputAudio.value = '';
    elInputAudio.click();
  });

  elInputAudio?.addEventListener('change', () => {
    if (elInputAudio.files && elInputAudio.files[0]) {
      carregarFicheiroAudio(elInputAudio.files[0]);
    }
  });

  // 2 - Layout
  elBtnFmtPost?.addEventListener('click', () => alterarFormato('post'));
  elBtnFmtStory?.addEventListener('click', () => alterarFormato('story'));

  // 3 - Cor da Waveform
  elBtnCorVermelho?.addEventListener('click', () => {
    corAtual = CORES_RUC.vermelho;
    elBtnCorVermelho.classList.add('active');
    elBtnCorBranco?.classList.remove('active');
    atualizarIndicadorSensibilidade();
  });

  elBtnCorBranco?.addEventListener('click', () => {
    corAtual = CORES_RUC.branco;
    elBtnCorBranco.classList.add('active');
    elBtnCorVermelho?.classList.remove('active');
    atualizarIndicadorSensibilidade();
  });

  // 4 - Sensibilidade da Waveform
  elSlider?.addEventListener('input', atualizarIndicadorSensibilidade);

  // 5 - Exportar Post
  elBtnExtMp4?.addEventListener('click', () => {
    extensaoEscolhida = 'mp4';
    elBtnExtMp4.classList.add('active');
    elBtnExtMov?.classList.remove('active');
  });

  elBtnExtMov?.addEventListener('click', () => {
    extensaoEscolhida = 'mov';
    elBtnExtMov.classList.add('active');
    elBtnExtMp4?.classList.remove('active');
  });

  // Reprodução e Exportação
  elBtnPlay?.addEventListener('click', alternarReproducao);
  elBtnExport?.addEventListener('click', iniciarExportacao);

  // Drag & Drop
  elDropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    elDropZone.classList.add('drag-over');
  });

  elDropZone?.addEventListener('dragleave', (e) => {
    if (!elDropZone.contains(e.relatedTarget)) {
      elDropZone.classList.remove('drag-over');
    }
  });

  elDropZone?.addEventListener('drop', (e) => {
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
}

function alterarFormato(novoFormato) {
  if (gravando || !FORMATOS[novoFormato]) return;
  formatoAtual = novoFormato;
  const cfg = FORMATOS[formatoAtual];

  if (formatoAtual === 'story') {
    elCanvasWrapper?.classList.add('is-story');
    elBtnFmtStory?.classList.add('active');
    elBtnFmtPost?.classList.remove('active');
  } else {
    elCanvasWrapper?.classList.remove('is-story');
    elBtnFmtPost?.classList.add('active');
    elBtnFmtStory?.classList.remove('active');
  }

  if (width !== cfg.largura || height !== cfg.altura) {
    resizeCanvas(cfg.largura, cfg.altura);
    pixelDensity(1);
  }
}

function removerImagem() {
  if (gravando) return;
  imagemFundo = null;
  if (elInputImg) elInputImg.value = '';
  elCanvasWrapper?.classList.remove('has-image');

  atualizarEstado(
    audioBuffer
      ? 'Imagem removida. Podes importar outro PNG ou exportar.'
      : 'Imagem removida. Importa a imagem e o áudio para começar.'
  );
}

function carregarFicheiroImagem(ficheiro) {
  atualizarEstado(`A carregar imagem ${ficheiro.name}…`);

  const leitor = new FileReader();
  leitor.onload = (evento) => {
    const dataUrl = evento.target.result;
    loadImage(
      dataUrl,
      (img) => {
        imagemFundo = img;
        elCanvasWrapper?.classList.add('has-image');

        const imgW = img.width || (img.elt && img.elt.naturalWidth) || 0;
        const imgH = img.height || (img.elt && img.elt.naturalHeight) || 0;

        if (imgW > 0 && imgH > 0) {
          if (imgH / imgW >= 1.45) {
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

        atualizarConfirmacao('Imagem importada:', `${ficheiro.name} (${imgW}×${imgH})`);
      },
      () => {
        atualizarEstado('Não foi possível ler a imagem. Usa um ficheiro PNG ou JPG válido.');
      }
    );
  };
  leitor.onerror = () => {
    atualizarEstado('Erro ao ler o ficheiro de imagem.');
  };
  leitor.readAsDataURL(ficheiro);
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

  if (elBtnPlay) elBtnPlay.textContent = '▶ Tocar';
  if (elBtnExport) elBtnExport.disabled = true;
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

    if (elBtnPlay) elBtnPlay.disabled = false;
    if (elBtnExport) elBtnExport.disabled = false;
    atualizarTempoUI(0, audioBuffer.duration);

    atualizarConfirmacao('Áudio importado:', `${ficheiro.name} (${formatarSegundos(audioBuffer.duration)})`);
  } catch (erro) {
    audioBuffer = null;
    if (elBtnPlay) elBtnPlay.disabled = true;
    if (elBtnExport) elBtnExport.disabled = true;
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
      if (elBtnPlay) elBtnPlay.textContent = '▶ Tocar';
      atualizarEstado('Reprodução em pausa.');
      return;
    }

    if (offsetPausa >= audioBuffer.duration) offsetPausa = 0;
    iniciarFonteAudio(offsetPausa, false);

    if (elBtnPlay) elBtnPlay.textContent = '❚❚ Pausa';
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
    if (elBtnPlay) elBtnPlay.textContent = '▶ Tocar';

    if (gravando) {
      finalizarExportacao();
    } else {
      atualizarEstado('Reprodução terminada.');
    }
  };

  fonte.start(0, inicioSegundos);
}

function escolherFormatoVideo() {
  const candidatosH264 = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
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
  if (elBtnImportImg) elBtnImportImg.disabled = bloqueado;
  if (elBtnImportAudio) elBtnImportAudio.disabled = bloqueado;
  if (elBtnFmtPost) elBtnFmtPost.disabled = bloqueado;
  if (elBtnFmtStory) elBtnFmtStory.disabled = bloqueado;
  if (elBtnExtMp4) elBtnExtMp4.disabled = bloqueado;
  if (elBtnExtMov) elBtnExtMov.disabled = bloqueado;
  if (elBtnPlay) elBtnPlay.disabled = bloqueado;
  if (elBtnExport) elBtnExport.disabled = bloqueado;
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

    offsetPausa = 0;
    rmsSuave = 0;
    gravando = true;
    chunksGravacao = [];

    alternarBloqueioUI(true);
    redraw();

    const formatoVideo = escolherFormatoVideo();
    const extFinal = formatoVideo.suportaH264 ? extensaoEscolhida : 'webm';

    atualizarEstado(`A gravar ${extFinal.toUpperCase()} (${cfg.largura}×${cfg.altura})… Aguarda o fim do áudio.`);

    const canvasEl = document.querySelector('#canvas-wrapper canvas');
    const canvasStream = canvasEl.captureStream(60);
    streamDest = audioCtx.createMediaStreamDestination();

    const streamFinal = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...streamDest.stream.getAudioTracks()
    ]);

    const opcoes = {
      videoBitsPerSecond: 8000000,
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

      if (elStatus) {
        elStatus.innerHTML = `Exportação concluída: <a class="status-pill" href="${ultimoUrlExportado}" download="${nomeSaida}">Descarregar ${nomeSaida}</a>`;
      }

      gravando = false;
      streamDest = null;
      alternarBloqueioUI(false);
    };

    mediaRecorder.start();
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

function atualizarConfirmacao(prefixo, textoEtiqueta) {
  if (!elStatus) return;
  elStatus.innerHTML = '';
  elStatus.appendChild(document.createTextNode(`${prefixo} `));

  const badge = document.createElement('span');
  badge.className = 'status-pill';
  badge.textContent = textoEtiqueta;
  elStatus.appendChild(badge);
}
