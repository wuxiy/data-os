"""dbt 1.10 工程 yml -> dbt 1.7 兼容（G7）：data_tests 键改 tests、测试的
arguments 包装平铺（1.8+ 语法 -> 1.7 语法）。只作用于生成副本，repo 工程面向
quality-runner 的 dbt 1.10 不动。"""
import sys, glob
import yaml

def flatten(node):
    """{test: {name, arguments: {...}}} -> {test: {name, **arguments}}"""
    if isinstance(node, dict):
        for key, value in list(node.items()):
            if key == "tests" and isinstance(value, list):
                for item in value:
                    if not isinstance(item, dict):
                        continue
                    for tname, tconf in list(item.items()):
                        if isinstance(tconf, dict) and "arguments" in tconf:
                            merged = {k: v for k, v in tconf.items() if k != "arguments"}
                            merged.update(tconf["arguments"])
                            item[tname] = merged
            else:
                flatten(value)
    elif isinstance(node, list):
        for item in node:
            flatten(item)

for path in glob.glob(sys.argv[1] + "/models/*.yml"):
    doc = yaml.safe_load(open(path))
    flatten(doc)
    # dbt 1.7 用 tests: 键（1.8+ 用 data_tests:）
    text = open(path).read().replace("data_tests:", "tests:")
    doc = yaml.safe_load(text)
    flatten(doc)
    yaml.safe_dump(doc, open(path, "w"), allow_unicode=True, sort_keys=False)
    print("downgraded", path)
