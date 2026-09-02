"""CLI：python -m app.cli assess <product> --profile medical-rag [--version v0.1.0]

直调本地引擎（不经 HTTP），输出对齐架构文档 §34 样式。
"""
from __future__ import annotations

import argparse
import sys

from adapters import DorisAdapter, OpenMetadataAdapter
from catalog import CatalogError, load_catalog
from engine import Engine, render_cli
from settings import settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="data-os ai-ready")
    sub = parser.add_subparsers(dest="command", required=True)
    assess_parser = sub.add_parser("assess", help="执行 AI Ready 评估")
    assess_parser.add_argument("product")
    assess_parser.add_argument("--profile", required=True,
                               help="声明仓库 profiles/ 中的 workload profile id")
    assess_parser.add_argument("--version", default="v0.1.0")
    args = parser.parse_args(argv)

    try:
        catalog = load_catalog(settings.repo_dir)
        engine = Engine(catalog, DorisAdapter(settings), OpenMetadataAdapter(settings))
        report = engine.assess(args.product, args.version, args.profile)
    except CatalogError as exc:
        print(f"声明仓库错误：{exc}", file=sys.stderr)
        return 2
    print(render_cli(report), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
