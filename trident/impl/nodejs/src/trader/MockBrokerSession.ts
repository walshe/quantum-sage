/**
 * src/trader/MockBrokerSession.ts
 *
 * Test double for IBrokerSession used in acceptance tests (MOCK_BROKER=true).
 * Auto-confirms market orders and position closes with synthetic execution events.
 * Never opens a real TCP/WebSocket connection.
 */

import { PT } from '../price-feed/CTraderSession.js';
import type { CTraderMessage } from '../price-feed/CTraderSession.js';
import type { IBrokerSession } from './IBrokerSession.js';

type MessageHandler = (msg: CTraderMessage) => void;

export class MockBrokerSession implements IBrokerSession {
  private readonly handlers = new Map<number, MessageHandler>();
  private positionCounter = 1000;
  private msgCounter = 0;

  readonly accountId: number | null = 999;

  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }

  onMessage(payloadType: number, handler: MessageHandler): void {
    this.handlers.set(payloadType, handler);
  }

  send(msg: Omit<CTraderMessage, 'clientMsgId'>): string {
    const clientMsgId = String(++this.msgCounter);

    if (msg.payloadType === PT.NEW_ORDER_REQ) {
      const positionId = ++this.positionCounter;
      setImmediate(() => {
        this.handlers.get(PT.EXECUTION_EVENT)?.({
          payloadType: PT.EXECUTION_EVENT,
          clientMsgId,
          payload: {
            executionType: 'POSITION_OPENED',
            clientMsgId,
            position: { positionId },
            order: { clientOrderId: clientMsgId, orderStatus: 'ORDER_STATUS_FILLED' },
          },
        });
      });
    } else if (msg.payloadType === PT.CLOSE_POSITION_REQ) {
      setImmediate(() => {
        this.handlers.get(PT.EXECUTION_EVENT)?.({
          payloadType: PT.EXECUTION_EVENT,
          clientMsgId,
          payload: {
            executionType: 'ORDER_FILLED',
            clientMsgId,
            order: { clientOrderId: clientMsgId, orderStatus: 'ORDER_STATUS_FILLED' },
          },
        });
      });
    }
    // AMEND_POSITION_SLTP_REQ: no confirmation needed

    return clientMsgId;
  }
}
