"""Exercise this Node through the real Muxiva Python Host wire protocol."""
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import unittest


class AvatarHostTest(unittest.TestCase):
    def test_real_host_streaming_and_cancel_wakeup(self):
        app = Path(__file__).resolve().parents[1]
        muxiva = Path(os.environ.get('MUXIVA_REPO', str(app.parent / 'muxiva')))
        library = muxiva / 'crates/muxiva-studio/src/node_library.rs'
        if not library.is_file():
            self.skipTest('Set MUXIVA_REPO to the Muxiva repository for Host integration')
        source = library.read_text(encoding='utf-8')
        host = source.split('const PYTHON_HOST: &str = r#"', 1)[1].split('"#;', 1)[0]
        base = {'node_id': 'avatar', 'input_port': 'audio_in', 'default_output': 'event_out'}
        frame = {'kind': 'audio', 'pcm_hex': struct.pack('<480h', *([3000] * 480)).hex(),
                 'sample_rate_hz': 24000, 'channels': 1, 'sequence': 1}
        commands = [
            {'op': 'prepare', **base},
            {'op': 'process', **base, 'frame': frame},
            {'op': 'signal', **base, 'signal': {'kind': 'signal', 'name': 'muxiva.playback.cancelled', 'sequence': 2}},
            {'op': 'process', **base, 'frame': None},
            {'op': 'process', **base, 'frame': frame},
            {'op': 'process', **base, 'frame': {**frame, 'sequence': 2}},
            {'op': 'close'},
        ]
        result = subprocess.run([sys.executable, '-u', '-c', host,
            str(app / '.muxiva/nodes/avatar_animation/node.py'), 'node:AvatarAnimationNode', '{}'],
            input='\n'.join(json.dumps(command) for command in commands) + '\n',
            text=True, capture_output=True, timeout=15, check=True)
        outputs = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertTrue(outputs[0]['ready'])
        self.assertFalse([item for item in outputs if item.get('ok') is False], result.stdout)
        events = [item['frame'] for item in outputs if item.get('kind') == 'emission']
        self.assertEqual([event['topic'] for event in events], [
            'muxiva.avatar.animation', 'muxiva.avatar.reset', 'muxiva.avatar.animation'])
        self.assertEqual([event['sequence'] for event in events], [1, 2, 2])
        self.assertEqual(json.loads(events[-1]['payload'])['sample_start'], 0)
        self.assertIn(1, [item.get('next_tick_ms') for item in outputs])


if __name__ == '__main__':
    unittest.main()
