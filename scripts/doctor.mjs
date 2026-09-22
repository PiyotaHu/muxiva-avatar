import {existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {characterAvailable} from '../server.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(join(root,'.env')))process.loadEnvFile(join(root,'.env'));
const python=join(root,'.venv/Scripts/python.exe');
const binary=process.env.MUXIVA_BINARY||resolve(root,'../.build/muxiva-windows/debug/muxiva.exe');
const checks={
 node:process.version,python:existsSync(python),muxiva:existsSync(binary),
 vad:existsSync(join(root,'.models/silero_vad.onnx')),
 asr:existsSync(join(root,'.models/asr-zh/model.onnx')),
 senseVoice:existsSync(join(root,'.models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx')),
 tts:existsSync(join(root,'.models/kokoro-multi-lang-v1_1/model.onnx')),
 avatar:characterAvailable(),
 modelConfigured:!!(process.env.MUXIVA_MODEL_BASE_URL&&process.env.MUXIVA_MODEL_ID&&(process.env.MUXIVA_MODEL_API_KEY||process.env.MUXIVA_MODEL_AUTH_MODE==='none'))
};
if(checks.python){const result=spawnSync(python,['-c','import sherpa_onnx, websockets, soxr; print(sherpa_onnx.__version__)'],{encoding:'utf8',windowsHide:true});checks.sherpa=result.status===0?result.stdout.trim():'IMPORT FAILED';}
if(checks.muxiva){const result=spawnSync(binary,['validate',join(root,'graph.json')],{cwd:root,env:{...process.env,MUXIVA_PYTHON:python,MUXIVA_NODE:process.execPath},encoding:'utf8',windowsHide:true});checks.graph=result.status===0; if(!checks.graph)console.error(result.stderr);}
console.log(JSON.stringify(checks,null,2));
if(!checks.modelConfigured)console.log('Model credentials are not printed. Configure .env before a real LLM conversation.');
process.exitCode=Object.values(checks).includes(false)?1:0;
