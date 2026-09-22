"""Deterministic speech-text checks; no models, network, or voice-quality claims."""
from __future__ import annotations
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from muxiva_avatar_speech.speech_text import normalize_for_speech


class SpeechTextTests(unittest.TestCase):
    def assert_cases(self, cases, **options):
        for original, expected in cases:
            with self.subTest(text=original, **options):
                self.assertEqual(normalize_for_speech(original, **options), expected)

    def test_chinese_enumeration_commas_are_not_thousands_separators(self):
        self.assert_cases([
            ("从1数到5：1，2，3，4，5。", "从一数到五：一，二，三，四，五。"),
            ("编号是1，234。", "编号是一，二百三十四。"),
            ("编号是１２，３４５。", "编号是十二，三百四十五。"),
            ("编号是1、234。", "编号是一、二百三十四。"),
        ])

    def test_sentence_pause_after_a_number_is_retained(self):
        self.assert_cases([
            ("今天25，明天26，后天27。", "今天二十五，明天二十六，后天二十七。"),
            ("温度25，先喝点水。", "温度二十五，先喝点水。"),
            ("温度25,先喝点水。", "温度二十五，先喝点水。"),
            ("温度25,,先喝点水。", "温度二十五，先喝点水。"),
        ])

    def test_valid_ascii_thousands_groups_remain_a_single_number(self):
        self.assert_cases([
            ("价格是1,234元。", "价格是一千二百三十四元。"),
            ("金额为-12,345.67元。", "金额为负一万二千三百四十五点六七元。"),
            ("共有123,456个。", "共有十二万三千四百五十六个。"),
            ("金额为￥1,234.50元。", "金额为¥一千二百三十四点五零元。"),
        ])

    def test_invalid_ascii_groups_preserve_each_number_and_pause(self):
        self.assert_cases([
            ("这些编号是1,2,3。", "这些编号是一，二，三。"),
            ("这些编号是1,234,5。", "这些编号是一，二百三十四，五。"),
            ("这些编号是12,34。", "这些编号是十二，三十四。"),
            ("这些编号是1234,567。", "这些编号是一千二百三十四，五百六十七。"),
            ("这些编号是0,123。", "这些编号是零，一百二十三。"),
            ("这些编号是1, 234。", "这些编号是一，二百三十四。"),
        ])

    def test_percentage_scope_does_not_swallow_an_enumeration(self):
        self.assert_cases([
            ("比例为1,234.5%。", "比例为百分之一千二百三十四点五。"),
            ("比例为1,2,3%。", "比例为一，二，百分之三。"),
            ("比例为1，234%。", "比例为一，百分之二百三十四。"),
            ("比例为-12.5%，上次为80%。", "比例为百分之负十二点五，上次为百分之八十。"),
        ])

    def test_emoji_pause_between_numbers_cannot_become_a_thousands_group(self):
        self.assert_cases([
            ("先读1🙂234。", "先读一，二百三十四。"),
            ("先读1🙂🙂234。", "先读一，二百三十四。"),
            ("好🙂我们开始吧。", "好，我们开始吧。"),
        ])

    def test_celsius_and_fahrenheit_symbols_survive_nfkc_as_spoken_units(self):
        self.assert_cases([
            ("现在室外是25℃，水温是37°C。", "现在室外是二十五摄氏度，水温是三十七摄氏度。"),
            ("气温是-2.5℃。", "气温是负二点五摄氏度。"),
            ("水温37 ° C左右。", "水温三十七摄氏度左右。"),
            ("室温为77℉，体温为98.6°F。", "室温为七十七华氏度，体温为九十八点六华氏度。"),
            ("温度为-40 °f。", "温度为负四十华氏度。"),
            ("角度为25°。", "角度为二十五度。"),
        ])

    def test_temperature_letters_are_not_extracted_from_longer_latin_words(self):
        self.assert_cases([
            ("符号是°Celsius和°Foo。", "符号是度Celsius和度Foo。"),
        ], language="zh")

    def test_bare_temperature_auto_language_uses_numeric_default_not_unit_letter(self):
        self.assert_cases([
            ("25℃", "二十五摄氏度"),
            ("-40 °F", "负四十华氏度"),
            ("25°C，77°F", "二十五摄氏度，七十七华氏度"),
            ("It is 25℃.", "It is 25°C."),
            ("CPU is 25°C.", "CPU is 25°C."),
        ])

    def test_existing_dates_times_decimals_and_leading_zeroes(self):
        self.assert_cases([
            ("今天是2026年9月14日。", "今天是二零二六年九月十四日。"),
            ("现在是09:30，稍后10:05再见。", "现在是零九：三十，稍后十：零五再见。"),
            ("圆周率约为3.1415。", "圆周率约为三点一四一五。"),
            ("编号007，余额-12.50元。", "编号零零七，余额负十二点五零元。"),
            ("金额为$12.5。", "金额为十二点五。"),
        ])

    def test_long_integer_identifier_heuristic_is_deliberately_unchanged(self):
        self.assert_cases([
            ("电话是13800138000。", "电话是一三八零零一三八零零零。"),
            ("数值为9600000。", "数值为九六零零零零零。"),
            ("数值为9,600,000。", "数值为九六零零零零零。"),
        ])

    def test_existing_markdown_url_and_display_only_cleanup(self):
        self.assert_cases([
            ("**你好**，朋友。", "你好，朋友。"),
            ("查看[文档](https://example.com)。", "查看文档。"),
            ("地址 https://example.com/path，接下来继续。", "地址，接下来继续。"),
            ("文字（补充）之后。", "文字，补充，之后。"),
            ("发邮件到 person@example.com，稍后联系。", "发邮件到，稍后联系。"),
        ])

    def test_existing_english_path_keeps_numbers_units_and_pause_shape(self):
        self.assert_cases([
            ("It is 25℃, then 77℉.", "It is 25°C,then 77°F."),
            ("Read 1，234 and 1,234.", "Read 1,234 and 1,234."),
            ("Read 1🙂234.", "Read 1,234."),
        ], language="en")


if __name__ == "__main__":
    unittest.main()
