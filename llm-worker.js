import { WebWorkerMLCEngineHandler } from 'https://esm.run/@mlc-ai/web-llm@0.2.81';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message) => handler.onmessage(message);
self.postMessage({ kind: 'ready' });
