import type { CTraderMessage } from '../price-feed/CTraderSession.js';

type MessageHandler = (msg: CTraderMessage) => void;

export interface IBrokerSession {
  readonly accountId: number | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(msg: Omit<CTraderMessage, 'clientMsgId'>): string;
  onMessage(payloadType: number, handler: MessageHandler): void;
}
