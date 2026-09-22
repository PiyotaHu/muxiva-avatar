const stateValues=Object.freeze({
  connection:new Set(['disconnected','connecting','connected','error']),
  microphone:new Set(['off','starting','on','muted']),
  activity:new Set(['idle','connecting','ready','listening','thinking','speaking','error'])
});
export function sanitizePetState(value){
  const source=value&&typeof value==='object'?value:{};
  return Object.freeze({
    connection:stateValues.connection.has(source.connection)?source.connection:'disconnected',
    microphone:stateValues.microphone.has(source.microphone)?source.microphone:'off',
    activity:stateValues.activity.has(source.activity)?source.activity:'idle'
  });
}
export function describePetState(value){
  const state=sanitizePetState(value);
  if(state.connection==='error'||state.activity==='error')return '需要重试';
  if(state.connection==='connecting')return '正在连接语音会话';
  if(state.connection!=='connected')return '未连接';
  if(state.activity==='speaking')return '已连接 · 正在回答';
  if(state.activity==='thinking')return '已连接 · 正在思考';
  if(state.microphone==='starting')return '已连接 · 正在开启麦克风';
  if(state.microphone==='on')return '已连接 · 麦克风开启';
  if(state.microphone==='muted')return '已连接 · 麦克风静音';
  return '已连接 · 麦克风关闭';
}
export function petMenuModel(value){
  const state=sanitizePetState(value),connected=state.connection==='connected',connecting=state.connection==='connecting';
  const connect=connected
    ?{label:'语音会话已连接',enabled:false,checked:true}
    :{label:connecting?'正在连接语音会话…':'连接语音会话',enabled:!connecting,checked:false,command:'connect'};
  const microphone=state.microphone==='starting'
    ?{label:'正在开启麦克风…',enabled:false}
    :state.microphone==='on'
      ?{label:'静音麦克风',enabled:true,command:'mute-microphone'}
      :state.microphone==='muted'
        ?{label:'恢复麦克风',enabled:true,command:'enable-microphone'}
        :{label:'开启麦克风',enabled:connected,command:'enable-microphone'};
  return Object.freeze({
    status:'状态：'+describePetState(state),connect:Object.freeze(connect),microphone:Object.freeze(microphone),
    disconnect:Object.freeze({label:'关闭通话',enabled:connected||connecting,command:'disconnect'})
  });
}