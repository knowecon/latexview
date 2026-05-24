import * as pdfjsLib from '/vendor/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';

const canvas = document.querySelector('#pdf-canvas');
const context = canvas.getContext('2d', { alpha: false });
const stage = document.querySelector('#stage');
const message = document.querySelector('#message');
const status = document.querySelector('#status');
const fileName = document.querySelector('#file-name');
const pageInput = document.querySelector('#page-input');
const pageCount = document.querySelector('#page-count');
const prevButton = document.querySelector('#prev-page');
const nextButton = document.querySelector('#next-page');
const thumbnailViewport = document.querySelector('#thumbnail-viewport');
const thumbnailContent = document.querySelector('#thumbnail-content');
const thumbnailCount = document.querySelector('#thumbnail-count');

const thumbnailMetrics = {
  itemHeight: 190,
  width: 132,
  overscan: 5,
  cacheLimit: 80,
  concurrency: 2
};

const state = {
  pdf: null,
  page: pageFromUrl(),
  totalPages: 0,
  version: Date.now(),
  renderTask: null,
  loadGeneration: 0,
  reloadTimer: null,
  resizeTimer: null,
  thumbnailItems: new Map(),
  thumbnailCache: new Map(),
  thumbnailQueue: [],
  activeThumbnailRenders: 0,
  thumbnailScrollTimer: null,
  thumbnailGeneration: 0
};

function pageFromUrl() {
  const pathMatch = window.location.pathname.match(/^\/page\/(\d+)$/);
  if (pathMatch) {
    const pathPage = Number(pathMatch[1]);
    return Number.isInteger(pathPage) && pathPage > 0 ? pathPage : 1;
  }
  const raw = new URL(window.location.href).searchParams.get('page');
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function setStatus(text, mode = 'normal') {
  status.textContent = text;
  status.dataset.mode = mode;
}

function markVersion() {
  document.documentElement.dataset.latexviewVersion = String(state.version);
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

function hideMessage() {
  message.hidden = true;
}

function clampPage(page) {
  const max = state.totalPages || page;
  return Math.max(1, Math.min(page, max));
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('page', String(state.page));
  window.history.replaceState({}, '', url);
}

function updateControls() {
  pageInput.value = String(state.page);
  pageCount.textContent = state.totalPages ? String(state.totalPages) : '?';
  prevButton.disabled = state.page <= 1;
  nextButton.disabled = state.totalPages > 0 && state.page >= state.totalPages;
  thumbnailCount.textContent = state.totalPages ? `${state.totalPages} pages` : '0 pages';
  syncActiveThumbnail();
}

async function cancelRender() {
  if (!state.renderTask) return;
  const task = state.renderTask;
  state.renderTask = null;
  task.cancel();
  try {
    await task.promise;
  } catch {
    // PDF.js rejects cancelled renders; that is expected while resizing/reloading.
  }
}

async function renderPage(pageNumber) {
  if (!state.pdf) return;
  await cancelRender();

  const page = await state.pdf.getPage(clampPage(pageNumber));
  const baseViewport = page.getViewport({ scale: 1 });
  const bounds = stage.getBoundingClientRect();
  const padding = 40;
  const fitWidth = Math.max(120, bounds.width - padding);
  const fitHeight = Math.max(120, bounds.height - padding);
  const scale = Math.max(
    0.1,
    Math.min(fitWidth / baseViewport.width, fitHeight / baseViewport.height)
  );
  const viewport = page.getViewport({ scale });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const transform = outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0];
  state.renderTask = page.render({ canvasContext: context, viewport, transform });
  try {
    await state.renderTask.promise;
    hideMessage();
    setStatus('live');
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') {
      showMessage(error.message || String(error));
      setStatus('render error', 'error');
    }
  } finally {
    if (state.renderTask) state.renderTask = null;
  }
}

function resetThumbnails() {
  state.thumbnailGeneration += 1;
  state.thumbnailQueue = [];
  state.activeThumbnailRenders = 0;
  state.thumbnailItems.clear();
  state.thumbnailCache.clear();
  thumbnailContent.replaceChildren();
  thumbnailContent.style.height = `${state.totalPages * thumbnailMetrics.itemHeight}px`;
  updateVisibleThumbnails();
}

function createThumbnailCard(pageNumber) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'thumbnail-card';
  card.dataset.page = String(pageNumber);
  card.style.transform = `translateY(${(pageNumber - 1) * thumbnailMetrics.itemHeight}px)`;
  card.setAttribute('aria-label', `Go to page ${pageNumber}`);

  const canvasWrap = document.createElement('span');
  canvasWrap.className = 'thumbnail-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvasWrap.append(canvas);

  const label = document.createElement('span');
  label.className = 'thumbnail-label';
  label.textContent = String(pageNumber);

  card.append(canvasWrap, label);
  card.addEventListener('click', () => {
    goToPage(pageNumber, { scrollThumbnail: false });
  });

  thumbnailContent.append(card);
  state.thumbnailItems.set(pageNumber, { card, canvas });
  requestThumbnailRender(pageNumber, canvas);
}

function updateVisibleThumbnails() {
  if (!state.pdf || state.totalPages === 0) return;

  const scrollTop = thumbnailViewport.scrollTop;
  const viewportHeight = thumbnailViewport.clientHeight || 1;
  const first = Math.max(
    1,
    Math.floor(scrollTop / thumbnailMetrics.itemHeight) + 1 - thumbnailMetrics.overscan
  );
  const last = Math.min(
    state.totalPages,
    Math.ceil((scrollTop + viewportHeight) / thumbnailMetrics.itemHeight) + thumbnailMetrics.overscan
  );

  for (const [pageNumber, item] of state.thumbnailItems) {
    if (pageNumber < first || pageNumber > last) {
      item.card.remove();
      state.thumbnailItems.delete(pageNumber);
    }
  }

  for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
    if (!state.thumbnailItems.has(pageNumber)) {
      createThumbnailCard(pageNumber);
    }
  }

  syncActiveThumbnail();
}

function syncActiveThumbnail() {
  for (const [pageNumber, item] of state.thumbnailItems) {
    const active = pageNumber === state.page;
    item.card.classList.toggle('is-active', active);
    if (active) {
      item.card.setAttribute('aria-current', 'page');
    } else {
      item.card.removeAttribute('aria-current');
    }
  }
}

function scrollThumbnailToPage(pageNumber) {
  if (!thumbnailViewport) return;
  const top = (pageNumber - 1) * thumbnailMetrics.itemHeight;
  const bottom = top + thumbnailMetrics.itemHeight;
  const visibleTop = thumbnailViewport.scrollTop;
  const visibleBottom = visibleTop + thumbnailViewport.clientHeight;

  if (top < visibleTop) {
    thumbnailViewport.scrollTop = Math.max(0, top - thumbnailMetrics.itemHeight);
  } else if (bottom > visibleBottom) {
    thumbnailViewport.scrollTop = Math.max(0, bottom - thumbnailViewport.clientHeight + thumbnailMetrics.itemHeight);
  }
  updateVisibleThumbnails();
}

function drawCachedThumbnail(canvas, cached) {
  canvas.width = cached.width;
  canvas.height = cached.height;
  canvas.style.width = cached.cssWidth;
  canvas.style.height = cached.cssHeight;
  const thumbnailContext = canvas.getContext('2d', { alpha: false });
  thumbnailContext.drawImage(cached.bitmap, 0, 0);
  canvas.dataset.rendered = 'true';
}

function rememberThumbnail(pageNumber, cached) {
  state.thumbnailCache.set(pageNumber, cached);
  while (state.thumbnailCache.size > thumbnailMetrics.cacheLimit) {
    const oldest = state.thumbnailCache.keys().next().value;
    state.thumbnailCache.delete(oldest);
  }
}

function requestThumbnailRender(pageNumber, canvas) {
  const cached = state.thumbnailCache.get(pageNumber);
  if (cached) {
    drawCachedThumbnail(canvas, cached);
    return;
  }

  state.thumbnailQueue = state.thumbnailQueue.filter((item) => item.pageNumber !== pageNumber);
  state.thumbnailQueue.push({
    pageNumber,
    canvas,
    generation: state.thumbnailGeneration
  });
  state.thumbnailQueue.sort((a, b) => Math.abs(a.pageNumber - state.page) - Math.abs(b.pageNumber - state.page));
  pumpThumbnailQueue();
}

function pumpThumbnailQueue() {
  while (
    state.activeThumbnailRenders < thumbnailMetrics.concurrency
    && state.thumbnailQueue.length > 0
  ) {
    const item = state.thumbnailQueue.shift();
    state.activeThumbnailRenders += 1;
    renderThumbnail(item)
      .catch(() => {})
      .finally(() => {
        state.activeThumbnailRenders -= 1;
        pumpThumbnailQueue();
      });
  }
}

async function renderThumbnail({ pageNumber, canvas, generation }) {
  if (!state.pdf || generation !== state.thumbnailGeneration || !canvas.isConnected) return;
  const page = await state.pdf.getPage(pageNumber);
  if (generation !== state.thumbnailGeneration || !canvas.isConnected) return;

  const baseViewport = page.getViewport({ scale: 1 });
  const scale = thumbnailMetrics.width / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = `${Math.round(viewport.width)}px`;
  const cssHeight = `${Math.round(viewport.height)}px`;

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = cssWidth;
  canvas.style.height = cssHeight;

  const thumbnailContext = canvas.getContext('2d', { alpha: false });
  thumbnailContext.setTransform(1, 0, 0, 1, 0, 0);
  thumbnailContext.fillStyle = '#ffffff';
  thumbnailContext.fillRect(0, 0, canvas.width, canvas.height);

  const transform = outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0];
  await page.render({ canvasContext: thumbnailContext, viewport, transform }).promise;
  canvas.dataset.rendered = 'true';

  if (window.createImageBitmap && canvas.isConnected) {
    const bitmap = await createImageBitmap(canvas);
    rememberThumbnail(pageNumber, {
      bitmap,
      width: canvas.width,
      height: canvas.height,
      cssWidth,
      cssHeight
    });
  }
}

async function loadDocument({ preservePage = true, retry = 0 } = {}) {
  clearTimeout(state.reloadTimer);
  state.reloadTimer = null;
  const loadGeneration = state.loadGeneration + 1;
  state.loadGeneration = loadGeneration;
  const requestedPage = preservePage ? state.page : pageFromUrl();
  const hasVisibleDocument = Boolean(state.pdf);
  setStatus(
    retry ? 'retrying' : hasVisibleDocument ? 'updating' : 'loading',
    retry ? 'warn' : 'normal'
  );
  if (hasVisibleDocument) {
    hideMessage();
  } else {
    showMessage(retry ? 'Waiting for PDF write to settle' : 'Loading PDF');
  }

  try {
    const oldDocument = state.pdf;
    const task = pdfjsLib.getDocument({
      url: `/document.pdf?version=${encodeURIComponent(state.version)}`,
      cMapPacked: true,
      cMapUrl: '/vendor/cmaps/',
      standardFontDataUrl: '/vendor/standard_fonts/',
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true
    });
    const pdf = await task.promise;
    if (loadGeneration !== state.loadGeneration) {
      await pdf.destroy();
      return;
    }
    await cancelRender();
    if (oldDocument) {
      await oldDocument.destroy();
    }
    state.pdf = pdf;
    state.totalPages = pdf.numPages;
    state.page = clampPage(requestedPage);
    updateControls();
    updateUrl();
    resetThumbnails();
    scrollThumbnailToPage(state.page);
    await renderPage(state.page);
  } catch (error) {
    if (retry < 8) {
      clearTimeout(state.reloadTimer);
      state.reloadTimer = setTimeout(() => {
        loadDocument({ preservePage, retry: retry + 1 });
      }, 250 + retry * 250);
      return;
    }
    showMessage(error.message || String(error));
    setStatus('load error', 'error');
  }
}

async function goToPage(page, options = {}) {
  const { scrollThumbnail = true } = options;
  state.page = clampPage(page);
  updateControls();
  updateUrl();
  if (scrollThumbnail) {
    scrollThumbnailToPage(state.page);
  }
  await renderPage(state.page);
}

prevButton.addEventListener('click', () => {
  goToPage(state.page - 1);
});

nextButton.addEventListener('click', () => {
  goToPage(state.page + 1);
});

pageInput.addEventListener('change', () => {
  const page = Number(pageInput.value);
  if (Number.isInteger(page) && page > 0) {
    goToPage(page);
  } else {
    updateControls();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.target === pageInput) return;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    goToPage(state.page - 1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    goToPage(state.page + 1);
  }
});

window.addEventListener('resize', () => {
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(() => {
    renderPage(state.page);
    updateVisibleThumbnails();
  }, 80);
});

thumbnailViewport.addEventListener('scroll', () => {
  clearTimeout(state.thumbnailScrollTimer);
  state.thumbnailScrollTimer = setTimeout(updateVisibleThumbnails, 24);
});

window.addEventListener('popstate', () => {
  goToPage(pageFromUrl());
});

const events = new EventSource('/events');
events.addEventListener('ready', (event) => {
  const data = JSON.parse(event.data);
  state.version = data.version ?? state.version;
  fileName.textContent = data.pdfName ?? fileName.textContent;
  markVersion();
  setStatus(data.compiling ? 'compiling' : 'connected', data.compiling ? 'warn' : 'normal');
});
events.addEventListener('compile-start', (event) => {
  const data = JSON.parse(event.data);
  fileName.textContent = data.pdfName ?? fileName.textContent;
  hideMessage();
  setStatus('compiling', 'warn');
});
events.addEventListener('compile-waiting', (event) => {
  const data = JSON.parse(event.data);
  fileName.textContent = data.pdfName ?? fileName.textContent;
  hideMessage();
  setStatus('waiting for PDF', 'warn');
});
events.addEventListener('compile-error', (event) => {
  const data = JSON.parse(event.data);
  fileName.textContent = data.pdfName ?? fileName.textContent;
  setStatus('compile error', 'error');
});
events.addEventListener('compile-end', (event) => {
  const data = JSON.parse(event.data);
  fileName.textContent = data.pdfName ?? fileName.textContent;
  setStatus('compiled');
});
events.addEventListener('update', (event) => {
  const data = JSON.parse(event.data);
  state.version = data.version ?? Date.now();
  fileName.textContent = data.pdfName ?? fileName.textContent;
  markVersion();
  setStatus('updated');
  loadDocument({ preservePage: true });
});
events.addEventListener('jump', (event) => {
  const data = JSON.parse(event.data);
  if (Number.isInteger(data.page) && data.page > 0) {
    goToPage(data.page);
  }
});
events.addEventListener('error', () => {
  setStatus('reconnecting', 'warn');
});

updateControls();
markVersion();
loadDocument({ preservePage: false });
