// Pure presentation derived from existing connection/audio observations.
// This does not schedule work, own turns, or decide when speech is interrupted.
export function describeExperience({ready=false,connecting=false,micOn=false,muted=false,
  microphonePending=false,playing=false,agentBusy=false,hasReply=false,failed=false}={}) {
  const microphoneLabel=!ready?'麦克风未开启':microphonePending?'正在请求麦克风权限…'
    :micOn?(muted?'麦克风已静音':'麦克风已开启 · 语音在本机识别'):'麦克风未开启 · 可以文字聊天';
  if(failed)return {activity:'error',label:'遇到问题，请查看对话提示',microphoneLabel};
  if(connecting&&!ready)return {activity:'connecting',label:'正在准备会话…',microphoneLabel};
  if(!ready)return {activity:'idle',label:'连接后，开始聊天',microphoneLabel};
  if(playing)return {activity:'speaking',label:'正在说话',microphoneLabel};
  if(agentBusy)return {activity:'thinking',label:'正在组织回答…',microphoneLabel};
  if(microphonePending)return {activity:'ready',label:'请在浏览器中允许麦克风',microphoneLabel};
  if(micOn&&!muted)return {activity:'listening',label:'麦克风已开启',microphoneLabel};
  // The current protocol reports segments, not whole-answer acoustic EOF.
  // Silence or a text reply never proves that all synthesis has finished.
  return {activity:'ready',label:muted?'安静陪伴 · 麦克风已静音'
    :hasReply?'回复已显示 · 可以继续聊天':'已连接 · 文字或语音都可以',microphoneLabel};
}
