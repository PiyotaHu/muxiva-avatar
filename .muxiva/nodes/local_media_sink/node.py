"""Bounded PCM/event egress. Cancellation watermarks belong at media boundary."""
import base64, json, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"local_media_source"))
from node import Bridge

def payload(value):
    if isinstance(value,str):
        try: return json.loads(value)
        except ValueError: return {"value":value}
    return value or {}

class LocalMediaSink:
    def __init__(self, config=None):
        self.bridge=Bridge("sink")
        self.before=0
        self.offsets={}
    def on_prepare(self, ctx): self.bridge.start()
    def on_process(self, frame, ctx):
        if frame is None:
            if self.bridge.error: raise RuntimeError(self.bridge.error)
            ctx.schedule_next_tick(20)
            return
        sequence=int(getattr(frame,"sequence",0))
        if hasattr(frame,"data") and hasattr(frame,"sample_rate_hz"):
            if sequence<self.before: return
            offset=self.offsets.get(sequence,0)
            count=len(frame.data)//(2*frame.channels)
            self.offsets[sequence]=offset+count
            self.bridge.send({"type":"audio","sequence":sequence,"stream_id":"assistant","sample_offset":offset,"sample_count":count,"sample_rate_hz":frame.sample_rate_hz,"channels":frame.channels,"pcm":base64.b64encode(frame.data).decode("ascii")})
        elif hasattr(frame,"text"):
            if ctx.input_port=="response_in" and sequence<self.before: return
            self.bridge.send({"type":"text","channel":ctx.input_port,"text":frame.text,"sequence":sequence})
        elif hasattr(frame,"topic"):
            self.bridge.send({"type":"event","topic":frame.topic,"payload":payload(frame.payload),"sequence":sequence})
        ctx.schedule_next_tick(10)
    def on_signal(self, signal, ctx):
        data=payload(signal.payload)
        before=int(data.get("turn_id",getattr(signal,"sequence",0)))
        self.before=max(self.before,before)
        self.offsets={k:v for k,v in self.offsets.items() if k>=self.before}
        self.bridge.send({"type":"cancel","before_sequence":self.before,"generation":data.get("generation",0),"reason":data.get("reason","explicit")})
    def on_finish(self, ctx=None): self.bridge.close()
    def on_abort(self, reason, ctx=None): self.on_finish(ctx)
