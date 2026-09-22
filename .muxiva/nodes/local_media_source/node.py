"""Loopback browser media transport. No model, ASR or turn policy."""
from __future__ import annotations
import base64, json, os, queue, threading, time
import muxiva

class Bridge:
    def __init__(self, role, capacity=256):
        self.role=role
        self.inbox=queue.Queue(capacity)
        self.outbox=queue.Queue(capacity)
        self.controls=queue.SimpleQueue()
        self.before=0
        self.stop=threading.Event()
        self.error=None
        self.socket=None
        self.thread=threading.Thread(target=self.run, daemon=True)
    def run(self):
        try:
            from websockets.sync.client import connect
            uri=os.environ["MUXIVA_MEDIA_URL"]
            with connect(uri, open_timeout=10, max_size=262144, proxy=None) as ws:
                self.socket=ws
                ws.send(json.dumps({"role":self.role,"session":os.environ["MUXIVA_MEDIA_SESSION"],"token":os.environ["MUXIVA_MEDIA_TOKEN"]}))
                next_audio_send=time.monotonic()
                pending=None
                while not self.stop.is_set():
                    try:
                        item=ws.recv(timeout=0.01)
                        self.inbox.put_nowait(item)
                    except TimeoutError: pass
                    while not self.controls.empty():
                        ws.send(json.dumps(self.controls.get(),ensure_ascii=False))
                        next_audio_send=time.monotonic()
                    for _ in range(64):
                        if pending is None:
                            try: pending=self.outbox.get_nowait()
                            except queue.Empty: break
                        item=pending
                        if item.get("type")=="audio":
                            if item["sequence"]<self.before:
                                pending=None
                                continue
                            now=time.monotonic()
                            if now<next_audio_send-0.12: break
                            count=item["sample_count"]
                            next_audio_send=max(next_audio_send,now)+count/item["sample_rate_hz"]
                        ws.send(json.dumps(item,ensure_ascii=False))
                        pending=None
        except Exception as error:
            if not self.stop.is_set(): self.error=type(error).__name__ + ": media connection failed"
    def start(self): self.thread.start()
    def send(self, item):
        if self.error: raise RuntimeError(self.error)
        if item.get("type")=="cancel":
            self.before=max(self.before,item.get("before_sequence",0))
            self.controls.put(item)
            return
        try: self.outbox.put(item,timeout=0.2)
        except queue.Full: raise RuntimeError("Media output queue exhausted; closing session instead of dropping speech")
    def close(self):
        self.stop.set()
        if self.socket: self.socket.close()
        self.thread.join(timeout=2)

class LocalMediaSource:
    def __init__(self, config=None):
        self.bridge=Bridge("source")
        self.sequence=0
    def on_prepare(self, ctx): self.bridge.start()
    def on_process(self, frame, ctx):
        if self.bridge.error: raise RuntimeError(self.bridge.error)
        for _ in range(32):
            try: raw=self.bridge.inbox.get_nowait()
            except queue.Empty: break
            if isinstance(raw, bytes):
                if len(raw)%2 or len(raw)>6400: raise ValueError("Invalid 16k mono microphone PCM packet")
                self.sequence+=1
                ctx.emit("audio_out",muxiva.AudioFrame(raw,16000,1,self.sequence))
                continue
            item=json.loads(raw)
            kind=item.get("type")
            if kind=="close": raise RuntimeError("Media session closed")
            if kind=="text":
                text=str(item.get("text","")).strip()
                if not text or len(text)>8000: continue
                ctx.emit("text_out",muxiva.TextFrame(text,sequence=time.monotonic_ns()//1000))
            elif kind=="interrupt":
                ctx.emit_signal("muxiva.turn.interrupt.requested",{"source":"browser-control"},sequence=time.monotonic_ns()//1000)
            elif kind=="playback":
                ctx.emit("event_out",muxiva.EventFrame("muxiva.media.playback.observed",json.dumps(item),source="local.media_source"))
        ctx.schedule_next_tick(10)
    def on_finish(self, ctx=None): self.bridge.close()
    def on_abort(self, reason, ctx=None): self.on_finish(ctx)
