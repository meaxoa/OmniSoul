// Volcengine Doubao bidirectional TTS (Seed-TTS 2.0) over WebSocket.
// Protocol reference: https://www.volcengine.com/docs/6561/1329505
// Browser connects via the Vite/nginx proxy at /api/volc-tts which injects the X-Api-* headers.

const TTS_PROXY_PATH = '/api/volc-tts';

const MsgType = {
  FullClientRequest: 0b0001,
  AudioOnlyClient: 0b0010,
  FullServerResponse: 0b1001,
  AudioOnlyServer: 0b1011,
  FrontEndResultServer: 0b1100,
  Error: 0b1111,
};

const Flags = {
  NoSeq: 0b0000,
  PositiveSeq: 0b0001,
  LastNoSeq: 0b0010,
  NegativeSeq: 0b0011,
  WithEvent: 0b0100,
};

const Serialization = { Raw: 0, JSON: 0b0001 };
const Compression = { None: 0, Gzip: 0b0001 };

const Event = {
  None: 0,
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  ConnectionFinished: 52,
  StartSession: 100,
  CancelSession: 101,
  FinishSession: 102,
  SessionStarted: 150,
  SessionCanceled: 151,
  SessionFinished: 152,
  SessionFailed: 153,
  TaskRequest: 200,
  UpdateConfig: 201,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352,
  TTSEnded: 359,
};

const CONNECTION_EVENTS = new Set([
  Event.StartConnection,
  Event.FinishConnection,
  Event.ConnectionStarted,
  Event.ConnectionFailed,
  Event.ConnectionFinished,
]);

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8');

function randomUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function encodeFrame({ type, flag, event, sessionId = '', payload = new Uint8Array(0) }) {
  const sidBytes = sessionId ? TEXT_ENCODER.encode(sessionId) : new Uint8Array(0);
  const carriesEvent = flag === Flags.WithEvent;
  const carriesSession = carriesEvent && !CONNECTION_EVENTS.has(event);

  let size = 4; // 4-byte header
  if (carriesEvent) size += 4;
  if (carriesSession) size += 4 + sidBytes.length;
  size += 4 + payload.length;

  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  let off = 0;

  buf[off++] = 0x11; // version=1, header_size=1 (=4 bytes)
  buf[off++] = (type << 4) | flag;
  buf[off++] = (Serialization.JSON << 4) | Compression.None;
  buf[off++] = 0x00;

  if (carriesEvent) {
    view.setInt32(off, event, false);
    off += 4;
    if (carriesSession) {
      view.setUint32(off, sidBytes.length, false);
      off += 4;
      buf.set(sidBytes, off);
      off += sidBytes.length;
    }
  }

  view.setUint32(off, payload.length, false);
  off += 4;
  if (payload.length) buf.set(payload, off);

  return buf.buffer;
}

function decodeFrame(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length < 4) throw new Error('frame too short');
  const view = new DataView(data.buffer, data.byteOffset, data.length);

  const headerSize = (data[0] & 0x0f) * 4;
  const type = data[1] >> 4;
  const flag = data[1] & 0x0f;
  const serialization = data[2] >> 4;
  const compression = data[2] & 0x0f;

  let off = headerSize;
  const msg = {
    type,
    flag,
    serialization,
    compression,
    event: 0,
    sessionId: '',
    connectId: '',
    sequence: 0,
    errorCode: 0,
    payload: new Uint8Array(0),
  };

  if (flag === Flags.WithEvent && off + 4 <= data.length) {
    msg.event = view.getInt32(off, false);
    off += 4;
    if (!CONNECTION_EVENTS.has(msg.event)) {
      if (off + 4 <= data.length) {
        const sidLen = view.getUint32(off, false);
        off += 4;
        if (sidLen && off + sidLen <= data.length) {
          msg.sessionId = TEXT_DECODER.decode(data.subarray(off, off + sidLen));
          off += sidLen;
        }
      }
    } else if (type === MsgType.FullServerResponse && off + 4 <= data.length) {
      const cidLen = view.getUint32(off, false);
      off += 4;
      if (cidLen && off + cidLen <= data.length) {
        msg.connectId = TEXT_DECODER.decode(data.subarray(off, off + cidLen));
        off += cidLen;
      }
    }
  }

  if (type === MsgType.Error && off + 4 <= data.length) {
    msg.errorCode = view.getUint32(off, false);
    off += 4;
  } else if (
    (flag === Flags.PositiveSeq || flag === Flags.NegativeSeq)
    && (type === MsgType.FullClientRequest
      || type === MsgType.FullServerResponse
      || type === MsgType.FrontEndResultServer
      || type === MsgType.AudioOnlyClient
      || type === MsgType.AudioOnlyServer)
    && off + 4 <= data.length
  ) {
    msg.sequence = view.getInt32(off, false);
    off += 4;
  }

  if (off + 4 <= data.length) {
    const payloadLen = view.getUint32(off, false);
    off += 4;
    if (payloadLen && off + payloadLen <= data.length) {
      msg.payload = data.subarray(off, off + payloadLen);
    }
  }

  return msg;
}

function buildProxyUrl() {
  const url = new URL(TTS_PROXY_PATH, window.location.origin);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * Stream Volcengine TTS for one text segment.
 *
 * @param {string} text
 * @param {object} options
 * @param {(chunk: Uint8Array) => void} options.onAudio       called with raw PCM16-LE @ sampleRate
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.speaker]                          defaults to zh_female_vv_uranus_bigtts
 * @param {number} [options.sampleRate]                       defaults to 24000
 * @param {number} [options.speechRate]                       integer in [-50, 100]
 * @param {string} [options.emotion]
 * @returns {Promise<void>}                                    resolves when the session finishes
 */
export function synthesizeText(text, options = {}) {
  const {
    onAudio,
    signal,
    speaker = 'zh_female_vv_uranus_bigtts',
    sampleRate = 24000,
    speechRate = 0,
    emotion,
  } = options;

  return new Promise((resolve, reject) => {
    if (!text) return resolve();
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));

    const sessionId = randomUuid();
    const ws = new WebSocket(buildProxyUrl());
    ws.binaryType = 'arraybuffer';

    let settled = false;
    let phase = 'connecting';

    const audioParams = { format: 'pcm', sample_rate: sampleRate, speech_rate: speechRate };
    if (emotion) audioParams.emotion = emotion;

    const baseBody = {
      user: { uid: randomUuid() },
      namespace: 'BidirectionalTTS',
      req_params: { speaker, audio_params: audioParams },
    };

    const abortHandler = () => fail(new DOMException('aborted', 'AbortError'));
    if (signal) signal.addEventListener('abort', abortHandler, { once: true });

    function cleanup() {
      if (signal) signal.removeEventListener('abort', abortHandler);
      try { ws.close(); } catch { /* noop */ }
    }

    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }

    function succeed() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }

    function send(type, flag, event, payload, includeSession = true) {
      ws.send(encodeFrame({
        type,
        flag,
        event,
        sessionId: includeSession ? sessionId : '',
        payload,
      }));
    }

    function sendJson(event, body) {
      send(
        MsgType.FullClientRequest,
        Flags.WithEvent,
        event,
        TEXT_ENCODER.encode(JSON.stringify(body)),
      );
    }

    ws.onopen = () => {
      phase = 'starting-connection';
      send(
        MsgType.FullClientRequest,
        Flags.WithEvent,
        Event.StartConnection,
        TEXT_ENCODER.encode('{}'),
        false,
      );
    };

    ws.onerror = () => fail(new Error('Volcengine TTS WebSocket error'));

    ws.onclose = (event) => {
      if (settled) return;
      fail(new Error(`Volcengine TTS closed early: code=${event.code} reason=${event.reason || '(none)'}`));
    };

    ws.onmessage = (event) => {
      let frame;
      try {
        frame = decodeFrame(event.data);
      } catch (err) {
        return fail(err);
      }

      if (frame.type === MsgType.Error) {
        const body = TEXT_DECODER.decode(frame.payload);
        return fail(new Error(`Volcengine TTS error [${frame.errorCode}]: ${body || '(empty)'}`));
      }

      if (frame.event === Event.ConnectionFailed || frame.event === Event.SessionFailed) {
        const body = TEXT_DECODER.decode(frame.payload);
        return fail(new Error(`Volcengine TTS ${frame.event === Event.ConnectionFailed ? 'connection' : 'session'} failed: ${body || '(empty)'}`));
      }

      if (frame.type === MsgType.AudioOnlyServer && frame.payload?.length) {
        try {
          onAudio?.(frame.payload);
        } catch (err) {
          fail(err);
        }
        return;
      }

      if (phase === 'starting-connection' && frame.event === Event.ConnectionStarted) {
        phase = 'starting-session';
        sendJson(Event.StartSession, { ...baseBody, event: Event.StartSession });
        return;
      }

      if (phase === 'starting-session' && frame.event === Event.SessionStarted) {
        phase = 'task-sent';
        sendJson(Event.TaskRequest, {
          ...baseBody,
          req_params: { ...baseBody.req_params, text },
          event: Event.TaskRequest,
        });
        sendJson(Event.FinishSession, {});
        return;
      }

      if (frame.event === Event.SessionFinished || frame.event === Event.TTSEnded) {
        sendJson(Event.FinishConnection, {});
        succeed();
      }
    };
  });
}
