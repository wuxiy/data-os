package com.cywu.dataos.mpi.matcher;

/**
 * 候选对评估结果的公共口径：三态。命中规则、规则证据与分数分解由各引擎
 * 的具体结果类型（RuleDecision / ScoreDecision / HybridDecision）承载，
 * 消费方按需收窄。
 */
public interface PairDecision {

    Outcome outcome();
}
