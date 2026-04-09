// src/lib/engine/worker-factory.ts
// Abstracts Worker construction to enable test injection of mock workers.

export interface WorkerFactory {
  create(url: URL): Worker;
}

export const defaultWorkerFactory: WorkerFactory = {
  create(url: URL): Worker {
    return new Worker(url, { type: 'module' });
  },
};
