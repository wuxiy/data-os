package com.cywu.dataos.controlplane.api;

/**
 * 异常消息的对外安全形式：空消息回退为「未知错误」，超长截断到 240
 * 字符。全库唯一实现，各执行器/通知/数据源适配器共用。
 */
public final class ErrorMessages {

    private ErrorMessages() {
    }

    public static String safe(Throwable exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) {
            return "未知错误";
        }
        return message.length() > 240 ? message.substring(0, 240) : message;
    }
}
