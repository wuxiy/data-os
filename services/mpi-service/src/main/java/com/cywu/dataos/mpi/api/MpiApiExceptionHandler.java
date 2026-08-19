package com.cywu.dataos.mpi.api;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 统一错误口径（与 control-plane 风格一致）：400 入参 / 404 不存在 /
 * 409 状态冲突，中文消息、Problem JSON 形态。
 */
@RestControllerAdvice
public class MpiApiExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> badRequest(IllegalArgumentException exception) {
        return problem(HttpStatus.BAD_REQUEST, exception.getMessage());
    }

    @ExceptionHandler(java.util.NoSuchElementException.class)
    public ResponseEntity<Map<String, Object>> notFound(java.util.NoSuchElementException exception) {
        return problem(HttpStatus.NOT_FOUND, exception.getMessage() == null ? "资源不存在" : exception.getMessage());
    }

    @ExceptionHandler(org.springframework.dao.EmptyResultDataAccessException.class)
    public ResponseEntity<Map<String, Object>> emptyResult(
            org.springframework.dao.EmptyResultDataAccessException exception) {
        return problem(HttpStatus.NOT_FOUND, "未找到请求的对象");
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> conflict(IllegalStateException exception) {
        return problem(HttpStatus.CONFLICT, exception.getMessage());
    }

    private ResponseEntity<Map<String, Object>> problem(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "status", status.value(),
                "message", message == null ? status.getReasonPhrase() : message));
    }
}
