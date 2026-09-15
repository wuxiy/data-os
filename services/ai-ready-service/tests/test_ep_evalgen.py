"""EP 评测集生成器契约（G17）：确定性选择、零患者标识、golden 可支撑。"""
from ep_evalgen import extract_case, generate, select_evenly


def test_extract_case_from_rendered_prescription():
    content = ("门诊处方记录：机构：XX人民医院；科室：心血管内科；开方日期：2026-08-01 10:00:00；"
               "性别：男；年龄：45；年龄单位：岁；临床诊断：原发性高血压。"
               "处方药品：1）药品 苯磺酸氨氯地平片，规格 5mg*28片，用法 口服，"
               "频率 每日一次，单次剂量 5 剂量单位 mg，数量 1 数量单位 盒，用药 28 天。")
    case = extract_case(content)
    assert case is not None
    assert "2026-08-01" in case["question"] and "心血管内科" in case["question"]
    assert "苯磺酸氨氯地平片" in case["question"]
    assert case["golden_sentence"].startswith("1）药品")
    # 问句零患者标识：不含姓名/联系/卡号类字段
    for banned in ("患者张", "电话", "身份证", "PAT-"):
        assert banned not in case["question"]


def test_extract_case_skips_unparseable_content():
    assert extract_case("无法解析的文本") is None


def test_select_evenly_is_deterministic_and_bounded():
    items = list(range(100))
    assert select_evenly(items, 5) == [0, 20, 40, 60, 80]
    assert select_evenly(items, 5) == select_evenly(items, 5)
    assert len(select_evenly(items, 250)) == 100  # 超量封顶为全集
    assert select_evenly([], 5) == []


def test_generate_maps_expected_document_and_section():
    # 同科室同药品但不同日期 -> 三元组唯一 -> 各自成案
    rows = [
        (f"doc-{i:03d}", "心血管内科",
         "门诊处方记录：机构：XX人民医院；科室：心血管内科；开方日期：%s 10:00:00。"
         "处方药品：1）药品 X，规格 S，用法 口服，频率 每日一次，单次剂量 5 剂量单位 mg，数量 1 数量单位 盒，用药 7 天。"
         % f"2026-08-{i + 1:02d}")
        for i in range(10)
    ]
    cases = generate(rows, 3)
    assert len(cases) == 3
    assert {case["expected_document_id"] for case in cases} == {"doc-000", "doc-003", "doc-006"}
    assert all(case["expected_section"] == "心血管内科" for case in cases)


def test_generate_dedups_identical_questions():
    rows = [
        (f"doc-{i:03d}", "内科",
         "门诊处方记录：科室：内科；开方日期：2026-08-01 10:00:00。"
         "处方药品：1）药品 X，规格 S，用法 口服，频率 每日一次，用药 7 天。")
        for i in range(10)
    ]
    # 同（日期, 科室, 药品）孪生处方 -> 三元组不唯一 -> 全部不构造问句
    assert generate(rows, 5) == []


def test_generate_keeps_ambiguous_twins_out_and_unique_in():
    def prescription(dept: str, date: str, drug: str) -> str:
        return (f"门诊处方记录：科室：{dept}；开方日期：{date} 10:00:00。"
                f"处方药品：1）药品 {drug}，规格 S，用法 口服，频率 每日一次，用药 7 天。")

    rows = [
        ("doc-a", "内科", prescription("内科", "2026-08-01", "X")),  # 与 doc-b 孪生 -> 排除
        ("doc-b", "内科", prescription("内科", "2026-08-01", "X")),
        ("doc-c", "内科", prescription("内科", "2026-08-02", "Y")),  # 唯一 -> 成案
        ("doc-d", "皮肤科", prescription("皮肤科", "2026-08-02", "Y")),  # 三元组不同 -> 唯一 -> 成案
    ]
    cases = generate(rows, 10)
    assert [case["expected_document_id"] for case in cases] == ["doc-c", "doc-d"]
