import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import { getFenId } from './utils.js';

const ENGINE_COUNT = 5;

class StockfishWorker {
  constructor(id) {
    this.id = id;
    this.engine = null;
    this.isBusy = false;
    this.currentResolve = null;
    this.currentReject = null;
    this.bestMove = null;
    this.score = null;
    this.scoreType = 'cp';
    this.pv = '';
    this.buffer = '';
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      try {
        this.engine = spawn('stockfish');
        
        this.engine.stdout.on('data', (data) => {
          this.buffer += data.toString();
          let newlineIdx;
          while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.substring(0, newlineIdx);
            this.buffer = this.buffer.substring(newlineIdx + 1);
            this.handleEngineLine(line.trim());
          }
        });

        this.engine.on('error', (err) => {
          console.error(`[Stockfish ${this.id}] Error:`, err);
          if (this.currentReject) this.currentReject(err);
        });

        this.engine.stdin.write('uci\n');
        this.engine.stdin.write('setoption name Threads value 2\n');
        this.engine.stdin.write('setoption name Hash value 256\n');
        this.engine.stdin.write('isready\n');

        const readyListener = (data) => {
          if (data.toString().includes('readyok')) {
            console.log(`[Stockfish ${this.id}] Ready.`);
            this.engine.stdout.removeListener('data', readyListener);
            resolve();
          }
        };
        this.engine.stdout.on('data', readyListener);
      } catch (err) {
        reject(err);
      }
    });
  }

  handleEngineLine(line) {
    if (!line) return;

    if (line.startsWith('info') && line.includes('score')) {
      const parts = line.split(' ');
      
      const scoreIdx = parts.indexOf('score');
      if (scoreIdx !== -1 && scoreIdx + 2 < parts.length) {
        this.scoreType = parts[scoreIdx + 1];
        const val = parseInt(parts[scoreIdx + 2]);
        if (!isNaN(val)) this.score = val;
      }

      const pvIdx = parts.indexOf('pv');
      if (pvIdx !== -1) {
        this.pv = parts.slice(pvIdx + 1).join(' ');
      }
    }

    if (line.startsWith('bestmove')) {
      this.bestMove = line.split(' ')[1];
      if (this.currentResolve) {
        const result = { 
          bestmove: this.bestMove, 
          score: this.score ?? 0, 
          scoreType: this.scoreType,
          pv: this.pv
        };
        const resolveFn = this.currentResolve;
        this.cleanup();
        resolveFn(result);
      }
    }
  }

  cleanup() {
    this.isBusy = false;
    this.currentResolve = null;
    this.currentReject = null;
    this.bestMove = null;
    this.score = null;
    this.scoreType = 'cp';
    this.pv = '';
  }

  async evaluate(fen, options = { depth: 22 }) {
    this.isBusy = true;
    this.buffer = '';
    const startTime = performance.now();

    console.log(`[StockfishWorker ${this.id}] ▶️  Starting eval for [${getFenId(fen)}...] (depth=${options.depth || 22})`);

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;

      this.engine.stdin.write(`position fen ${fen}\n`);
      
      const depth = options.depth || 22;
      this.engine.stdin.write(`go depth ${depth}\n`);

      const timeoutDuration = 30000;

      setTimeout(() => {
        if (this.currentResolve === resolve) {
          const elapsed = (performance.now() - startTime).toFixed(1);
          console.warn(`[StockfishWorker ${this.id}] ⏱️  TIMEOUT after ${elapsed}ms for [${getFenId(fen)}...]`);
          this.cleanup();
          reject(new Error(`Stockfish ${this.id} evaluation timed out`));
        }
      }, timeoutDuration);
    }).then(result => {
      const elapsed = (performance.now() - startTime).toFixed(1);
      console.log(`[StockfishWorker ${this.id}] ✅ Completed [${getFenId(fen)}...] in ${elapsed}ms (score=${result.score}, bestmove=${result.bestmove}, pv=${result.pv?.substring(0,50)})`);
      return result;
    }).catch(err => {
      const elapsed = (performance.now() - startTime).toFixed(1);
      console.error(`[StockfishWorker ${this.id}] ❌ Failed [${getFenId(fen)}...] after ${elapsed}ms: ${err.message}`);
      throw err;
    });
  }
}

class StockfishPool {
  constructor(count) {
    this.workers = Array.from({ length: count }, (_, i) => new StockfishWorker(i));
    this.queue = [];
  }

  async waitForAllReady() {
    await Promise.all(this.workers.map(w => w.initPromise));
    console.log(`[StockfishPool] ✅ All ${ENGINE_COUNT} workers initialized and ready.`);
  }

  async addRequest(fen, options) {
    const startQueue = performance.now();
    const queuePos = this.queue.length + 1;
    const idleCount = this.workers.filter(w => !w.isBusy).length;
    console.log(`[StockfishPool] 📥 Request queued for [${getFenId(fen)}...] (queue pos: ${queuePos}, idle workers: ${idleCount}/${ENGINE_COUNT})`);
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, options, resolve, reject, startQueue });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.queue.length === 0) return;

    const idleWorker = this.workers.find(w => !w.isBusy);
    if (!idleWorker) {
        console.log(`[StockfishPool] ⏳ All workers busy, ${this.queue.length} requests waiting...`);
        return;
    }

    const { fen, options, resolve, reject, startQueue } = this.queue.shift();
    
    const waitTime = (performance.now() - startQueue).toFixed(1);
    console.log(`[StockfishPool] ▶️  Dispatching [${getFenId(fen)}...] to worker ${idleWorker.id} (waited ${waitTime}ms in queue, ${this.queue.length} remaining)`);

    try {
      const result = await idleWorker.evaluate(fen, options);
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.processQueue();
    }
  }
}

export const pool = new StockfishPool(ENGINE_COUNT);