package com.cywu.dataos.controlplane.api;

import java.time.Instant;
import java.util.Map;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.cywu.dataos.controlplane.ai.EngineNotConfiguredException;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(EngineNotConfiguredException.class)
    ProblemDetail engineNotConfigured(EngineNotConfiguredException exception) {
        var detail = problem(HttpStatus.SERVICE_UNAVAILABLE, "AI_READY_ENGINE_NOT_CONFIGURED",
                exception.getMessage());
        return detail;
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    ProblemDetail notFound(ResourceNotFoundException exception) {
        return problem(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", exception.getMessage());
    }

    @ExceptionHandler(ConflictException.class)
    ProblemDetail conflict(ConflictException exception) {
        return problem(HttpStatus.CONFLICT, "CONFLICT", exception.getMessage());
    }

    @ExceptionHandler(InvalidRequestException.class)
    ProblemDetail invalidRequest(InvalidRequestException exception) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", exception.getMessage());
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ProblemDetail duplicate(DuplicateKeyException exception) {
        return problem(HttpStatus.CONFLICT, "DUPLICATE_RESOURCE", "相同业务对象已经存在");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail invalid(MethodArgumentNotValidException exception) {
        var detail = problem(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "请求参数不完整或格式不正确");
        detail.setProperty("fields", exception.getBindingResult().getFieldErrors().stream()
                .collect(java.util.stream.Collectors.toMap(
                        field -> field.getField(),
                        field -> field.getDefaultMessage() == null ? "invalid" : field.getDefaultMessage(),
                        (first, ignored) -> first)));
        return detail;
    }

    private ProblemDetail problem(HttpStatus status, String code, String message) {
        var detail = ProblemDetail.forStatusAndDetail(status, message);
        detail.setTitle("data-os API error");
        detail.setProperty("code", code);
        // Keep the RFC 9457 `detail` field and expose the same text as `message`
        // for the portal and existing Chinese business clients.
        detail.setProperty("message", message);
        detail.setProperty("timestamp", Instant.now());
        detail.setProperty("trace", Map.of("service", "control-plane"));
        return detail;
    }
}
