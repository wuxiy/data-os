package com.cywu.dataos.controlplane.run;

import java.util.Optional;

/**
 * 为 SUBMITTING 恢复重投构建提交命令。返回空表示接入方已自行处置该
 * 运行（如质量侧：所属治理问题已不存在时直接标记孤儿终态）。
 */
@FunctionalInterface
public interface RunCommandSource<R, C> {

    Optional<C> commandFor(R run);
}
