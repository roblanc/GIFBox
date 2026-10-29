import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');
const GIFS_JSON = path.join(PROJECT_ROOT, 'data/gifs.json');
const MANIFEST_OUT = path.join(PROJECT_ROOT, 'data/cutouts-manifest.json');
const CUTOUTS_WORKTREE = '/tmp/gifbox-cutouts-wt';
const CUTOUTS_DIR = path.join(CUTOUTS_WORKTREE, 'cutouts');

const SKIP_METADATA_RE =
  /\b(bell curve|graph|chart|diagram|iceberg metaphor|tier list|political compass|alignment chart|starter pack|bingo card|blank screen|wallpaper|screenshot|tweet|headline|breaking news|map of|calendar|scoreboard|4 panel|four panel|expanding brain|galaxy brain|venn diagram|flowchart|infographic)\b/i;

const INPUT_SIZE = 320;
const PLANE = INPUT_SIZE * INPUT_SIZE;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const MAX_OUT_DIM = 920;

function parseArgs() {
  const args = process.argv.slice(2);
  let workerId = null;
  let numWorkers = 4;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--worker') workerId = parseInt(args[++i], 10);
    if (args[i] === '--workers') numWorkers = parseInt(args[++i], 10);
  }
  return { workerId, numWorkers };
}

async function fetchImageBuffer(item) {
  if (item.file) {
    const localPath = path.join(PROJECT_ROOT, 'public/gifs', item.file);
    if (fs.existsSync(localPath)) {
      return fs.promises.readFile(localPath);
    }
  }
  const url = item.url;
  if (!url || !url.startsWith('http')) {
    throw new Error('No valid URL');
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 14000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } catch (err) {
      if (attempt === 1) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function runWorker(workerId, numWorkers) {
  const reqProject = createRequire(path.join(PROJECT_ROOT, 'package.json'));
  const sharp = reqProject('sharp');
  sharp.concurrency(1);

  const ortPkg = path.join(
    os.homedir(),
    '.cache/hyperframes/optional/onnxruntime-node@1.21.1/package.json'
  );
  const ort = createRequire(ortPkg)('onnxruntime-node');
  const modelFile = path.join(
    os.homedir(),
    '.cache/hyperframes/background-removal/models/u2net_human_seg.onnx'
  );

  const allItems = JSON.parse(fs.readFileSync(GIFS_JSON, 'utf8'));
  const imageItems = allItems.filter(
    (g) => (g.format === 'image' || g.type === 'image') && g.category !== 'Stickers'
  );
  const myItems = imageItems.filter((_, idx) => idx % numWorkers === workerId);

  const providers = workerId === 0 ? ['coreml', 'cpu'] : ['cpu'];
  const session = await ort.InferenceSession.create(modelFile, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
    intraOpNumThreads: workerId === 0 ? 2 : 3,
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const inputData = new Float32Array(3 * PLANE);
  const maskBuf = Buffer.allocUnsafe(PLANE);

  const stateFile = path.join(CUTOUTS_WORKTREE, `worker-${workerId}.json`);
  const accepted = {};
  const stats = {
    total: myItems.length,
    processed: 0,
    accepted: 0,
    skippedMeta: 0,
    skippedAlpha: 0,
    skippedMask: 0,
    errors: 0,
  };

  const saveCheckpoint = () => {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ workerId, stats, accepted })
    );
  };

  // Bounded prefetch buffer of 20 concurrent downloads (never drops resolvers!)
  const PREFETCH_CONCURRENCY = 20;
  const MAX_QUEUE = 48;
  const queue = [];
  let fetchIndex = 0;
  let fetchDone = false;
  let consumerWaiter = null;
  const producerWaiters = [];

  const wakeConsumer = () => {
    if (consumerWaiter) {
      const fn = consumerWaiter;
      consumerWaiter = null;
      fn();
    }
  };

  const wakeProducers = () => {
    while (queue.length < MAX_QUEUE && producerWaiters.length > 0) {
      const fn = producerWaiters.shift();
      fn();
    }
  };

  async function producerLoop() {
    const launchNext = async () => {
      while (fetchIndex < myItems.length) {
        while (queue.length >= MAX_QUEUE) {
          await new Promise((r) => {
            producerWaiters.push(r);
          });
        }
        if (fetchIndex >= myItems.length) break;
        const item = myItems[fetchIndex++];
        const outPath = path.join(CUTOUTS_DIR, `${item.slug}.webp`);

        if (fs.existsSync(outPath)) {
          const st = fs.statSync(outPath);
          if (st.size > 200) {
            queue.push({ item, existingSize: st.size });
            wakeConsumer();
            continue;
          }
        }

        const metaText = `${item.title} ${item.slug} ${(item.tags || []).join(' ')}`;
        if (SKIP_METADATA_RE.test(metaText)) {
          queue.push({ item, skipReason: 'meta' });
          wakeConsumer();
          continue;
        }

        try {
          const buf = await fetchImageBuffer(item);
          queue.push({ item, buf });
        } catch {
          queue.push({ item, skipReason: 'error' });
        }
        wakeConsumer();
      }
    };

    const workers = [];
    for (let k = 0; k < PREFETCH_CONCURRENCY; k++) {
      workers.push(launchNext());
    }
    await Promise.all(workers);
    fetchDone = true;
    wakeConsumer();
  }

  producerLoop();

  while (!fetchDone || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise((r) => {
        consumerWaiter = r;
      });
      continue;
    }

    const job = queue.shift();
    wakeProducers();

    const { item, buf, skipReason, existingSize } = job;
    stats.processed++;

    if (existingSize) {
      stats.accepted++;
      accepted[item.slug] = {
        file: `cutouts/${item.slug}.webp`,
        bytes: existingSize,
      };
      if (stats.processed % 40 === 0) saveCheckpoint();
      continue;
    }

    if (skipReason === 'meta') {
      stats.skippedMeta++;
      if (stats.processed % 40 === 0) saveCheckpoint();
      continue;
    }
    if (skipReason === 'error' || !buf) {
      stats.errors++;
      if (stats.processed % 40 === 0) saveCheckpoint();
      continue;
    }

    try {
      // Decode & cap dimension to MAX_OUT_DIM
      const decoded = await sharp(buf, { failOn: 'none' })
        .rotate()
        .resize(MAX_OUT_DIM, MAX_OUT_DIM, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = decoded.info;
      const srcRgba = decoded.data;
      const numPixels = width * height;
      if (width < 48 || height < 48) {
        stats.skippedMask++;
        continue;
      }

      // Check if already transparent (>10% transparent pixels)
      let transparentCount = 0;
      const rgb = Buffer.allocUnsafe(numPixels * 3);
      for (let i = 0; i < numPixels; i++) {
        rgb[i * 3] = srcRgba[i * 4];
        rgb[i * 3 + 1] = srcRgba[i * 4 + 1];
        rgb[i * 3 + 2] = srcRgba[i * 4 + 2];
        if (srcRgba[i * 4 + 3] < 128) transparentCount++;
      }
      if (transparentCount / numPixels > 0.1) {
        stats.skippedAlpha++;
        continue;
      }

      const resized320 = await sharp(rgb, { raw: { width, height, channels: 3 } })
        .resize(INPUT_SIZE, INPUT_SIZE, { kernel: 'lanczos3', fit: 'fill' })
        .raw()
        .toBuffer();

      let maxPix = 0;
      for (let i = 0; i < resized320.length; i++) {
        if (resized320[i] > maxPix) maxPix = resized320[i];
      }
      if (maxPix === 0) maxPix = 1;

      for (let i = 0; i < PLANE; i++) {
        inputData[i] = (resized320[i * 3] / maxPix - MEAN[0]) / STD[0];
        inputData[PLANE + i] = (resized320[i * 3 + 1] / maxPix - MEAN[1]) / STD[1];
        inputData[2 * PLANE + i] = (resized320[i * 3 + 2] / maxPix - MEAN[2]) / STD[2];
      }

      const tensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const outputs = await session.run({ [inputName]: tensor });
      const raw = outputs[outputName].data;

      let lo = Infinity;
      let hi = -Infinity;
      let fgCount = 0;
      let bgCount = 0;
      let midCount = 0;
      let centerFg = 0;

      const xMin = Math.floor(INPUT_SIZE * 0.12);
      const xMax = Math.ceil(INPUT_SIZE * 0.88);
      const yMin = Math.floor(INPUT_SIZE * 0.08);
      const yMax = Math.ceil(INPUT_SIZE * 0.95);

      for (let y = 0; y < INPUT_SIZE; y++) {
        const rowOff = y * INPUT_SIZE;
        const inY = y >= yMin && y <= yMax;
        for (let x = 0; x < INPUT_SIZE; x++) {
          const v = raw[rowOff + x];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          if (v >= 0.5) {
            fgCount++;
            if (inY && x >= xMin && x <= xMax) centerFg++;
          } else if (v <= 0.15) {
            bgCount++;
          }
          if (v > 0.15 && v < 0.85) midCount++;
        }
      }

      const fgRatio = fgCount / PLANE;
      const bgRatio = bgCount / PLANE;
      const midRatio = midCount / PLANE;
      const centerMass = fgCount > 0 ? centerFg / fgCount : 0;

      // Character Relevance & Crispness Quality Gate
      if (
        hi < 0.85 ||
        fgRatio < 0.045 ||
        fgRatio > 0.86 ||
        bgRatio < 0.13 ||
        midRatio > 0.115 ||
        centerMass < 0.45
      ) {
        stats.skippedMask++;
        if (stats.processed % 40 === 0) saveCheckpoint();
        continue;
      }

      const range = hi - lo || 1;
      for (let i = 0; i < PLANE; i++) {
        let val = Math.round(((raw[i] - lo) / range) * 255);
        if (val < 10) val = 0;
        else if (val > 246) val = 255;
        maskBuf[i] = val;
      }

      const fullMask = await sharp(maskBuf, {
        raw: { width: INPUT_SIZE, height: INPUT_SIZE, channels: 1 },
      })
        .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
        .toColourspace('b-w')
        .raw()
        .toBuffer();

      const outRgba = Buffer.allocUnsafe(numPixels * 4);
      for (let i = 0; i < numPixels; i++) {
        const a = fullMask[i];
        if (a === 0) {
          outRgba[i * 4] = 0;
          outRgba[i * 4 + 1] = 0;
          outRgba[i * 4 + 2] = 0;
          outRgba[i * 4 + 3] = 0;
        } else {
          outRgba[i * 4] = rgb[i * 3];
          outRgba[i * 4 + 1] = rgb[i * 3 + 1];
          outRgba[i * 4 + 2] = rgb[i * 3 + 2];
          outRgba[i * 4 + 3] = a;
        }
      }

      const webpBuf = await sharp(outRgba, {
        raw: { width, height, channels: 4 },
      })
        .webp({ quality: 85, alphaQuality: 90, effort: 3 })
        .toBuffer();

      const outPath = path.join(CUTOUTS_DIR, `${item.slug}.webp`);
      const tmpPath = `${outPath}.tmp-${workerId}`;
      fs.writeFileSync(tmpPath, webpBuf);
      fs.renameSync(tmpPath, outPath);

      stats.accepted++;
      accepted[item.slug] = {
        file: `cutouts/${item.slug}.webp`,
        bytes: webpBuf.length,
        fg: Number(fgRatio.toFixed(3)),
        mid: Number(midRatio.toFixed(3)),
      };
    } catch {
      stats.errors++;
    }

    if (stats.processed % 40 === 0) {
      saveCheckpoint();
    }
  }

  saveCheckpoint();
  await session.release();
}

async function runMaster(numWorkers) {
  fs.mkdirSync(CUTOUTS_DIR, { recursive: true });
  const tStart = Date.now();
  console.log(`Starting ${numWorkers} parallel CoreML background-removal workers into ${CUTOUTS_DIR}...`);

  const children = [];
  for (let w = 0; w < numWorkers; w++) {
    const child = spawn(
      process.execPath,
      [__filename, '--worker', String(w), '--workers', String(numWorkers)],
      { stdio: ['ignore', 'inherit', 'pipe'] }
    );
    child.stderr.on('data', (d) => {
      const s = d.toString();
      if (!s.includes('VerifyEachNodeIsAssignedToAnEp') && !s.includes('GetCapability')) {
        process.stderr.write(`[W${w}] ${s}`);
      }
    });
    children.push(
      new Promise((resolve, reject) => {
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Worker ${w} exited with code ${code}`));
        });
      })
    );
  }

  const monitor = setInterval(() => {
    let total = 0;
    let processed = 0;
    let accepted = 0;
    let skippedMeta = 0;
    let skippedAlpha = 0;
    let skippedMask = 0;
    let errors = 0;
    for (let w = 0; w < numWorkers; w++) {
      const sf = path.join(CUTOUTS_WORKTREE, `worker-${w}.json`);
      if (fs.existsSync(sf)) {
        try {
          const st = JSON.parse(fs.readFileSync(sf, 'utf8')).stats;
          total += st.total;
          processed += st.processed;
          accepted += st.accepted;
          skippedMeta += st.skippedMeta;
          skippedAlpha += st.skippedAlpha;
          skippedMask += st.skippedMask;
          errors += st.errors;
        } catch {}
      }
    }
    if (processed > 0) {
      const elapsed = (Date.now() - tStart) / 1000;
      const rate = processed / elapsed;
      const rem = total > processed ? Math.round((total - processed) / rate) : 0;
      console.log(
        `[${Math.round(elapsed)}s] ${processed}/${total} (${((processed / Math.max(1, total)) * 100).toFixed(1)}%) | Accepted: ${accepted} | Skipped(meta:${skippedMeta}, mask:${skippedMask}, alpha:${skippedAlpha}, err:${errors}) | ${rate.toFixed(1)} img/s | ETA ~${rem}s`
      );
    }
  }, 15000);

  try {
    await Promise.all(children);
  } finally {
    clearInterval(monitor);
  }

  // Merge all worker manifests + verify files on disk
  const merged = {};
  for (let w = 0; w < numWorkers; w++) {
    const sf = path.join(CUTOUTS_WORKTREE, `worker-${w}.json`);
    if (fs.existsSync(sf)) {
      const data = JSON.parse(fs.readFileSync(sf, 'utf8'));
      Object.assign(merged, data.accepted || {});
      fs.unlinkSync(sf);
    }
  }

  // Ensure any pre-seeded cutouts (e.g. Willy Wonka) are also registered
  for (const name of fs.readdirSync(CUTOUTS_DIR)) {
    if (!name.endsWith('.webp')) continue;
    const slug = name.slice(0, -5);
    if (!merged[slug]) {
      const st = fs.statSync(path.join(CUTOUTS_DIR, name));
      merged[slug] = { file: `cutouts/${name}`, bytes: st.size };
    }
  }

  let totalBytes = 0;
  for (const v of Object.values(merged)) totalBytes += v.bytes || 0;

  fs.writeFileSync(
    MANIFEST_OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: Object.keys(merged).length,
        totalMegabytes: Number((totalBytes / (1024 * 1024)).toFixed(2)),
        items: merged,
      },
      null,
      2
    )
  );

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(
    `Done in ${elapsed}s! Generated ${Object.keys(merged).length} crisp character cutouts (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) -> ${MANIFEST_OUT}`
  );
}

const { workerId, numWorkers } = parseArgs();
if (workerId !== null && !Number.isNaN(workerId)) {
  await runWorker(workerId, numWorkers);
} else {
  await runMaster(numWorkers);
}
