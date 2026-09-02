package com.cywu.dataos.mpi.matcher;

/**
 * 候选对评估口径：三态 + 硬冲突。前三态由匹配引擎产出；HARD_CONFLICT
 * 不是引擎产物——人工否决/拆分（H-ep1/H-ep2）在编排层前置（见
 * MpiDecisionService），仅出现在编排层写入的终态决策里。
 */
public enum Outcome {
    AUTO_MATCH, REVIEW, NO_MATCH, HARD_CONFLICT
}
