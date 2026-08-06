package com.cywu.dataos.controlplane.audit;

import java.util.UUID;

import com.cywu.dataos.controlplane.security.TenantScope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class AuditInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(AuditInterceptor.class);
    private static final String TRACE_ID = "X-Trace-Id";
    private static final String SCOPE = AuditInterceptor.class.getName() + ".scope";
    private static final String ACTOR = AuditInterceptor.class.getName() + ".actor";

    private final AuditRepository repository;
    private final TenantScope tenantScope;

    public AuditInterceptor(AuditRepository repository, TenantScope tenantScope) {
        this.repository = repository;
        this.tenantScope = tenantScope;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        var traceId = request.getHeader(TRACE_ID);
        var resolvedTraceId = normalizeTraceId(traceId);
        request.setAttribute(TRACE_ID, resolvedTraceId);
        response.setHeader(TRACE_ID, resolvedTraceId);
        var scope = tenantScope.current();
        request.setAttribute(SCOPE, scope);
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        var actor = scope.subject();
        if (authentication instanceof JwtAuthenticationToken token) {
            actor = token.getToken().getClaimAsString("preferred_username");
            if (actor == null || actor.isBlank()) actor = scope.subject();
        }
        request.setAttribute(ACTOR, actor);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
                                Exception exception) {
        if (!request.getRequestURI().startsWith("/api/")) return;
        try {
            var scope = (TenantScope.Scope) request.getAttribute(SCOPE);
            var actor = String.valueOf(request.getAttribute(ACTOR));
            var subject = scope.subject();
            repository.record(subject, actor, scope.tenantId(), scope.institutionId(), request.getMethod(),
                    request.getRequestURI(), response.getStatus(), request.getMethod() + " " + request.getRequestURI(),
                    String.valueOf(request.getAttribute(TRACE_ID)), remoteAddress(request), java.time.Instant.now());
        } catch (RuntimeException auditFailure) {
            // Auditing must not turn a successful business request into a 500.
            log.warn("写入审计事件失败，path={}", request.getRequestURI(), auditFailure);
        }
    }

    private String remoteAddress(HttpServletRequest request) {
        var forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",")[0].trim();
        return request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
    }

    private String normalizeTraceId(String traceId) {
        if (traceId == null || traceId.isBlank()) return UUID.randomUUID().toString();
        var normalized = traceId.trim().replaceAll("[^A-Za-z0-9._:-]", "_");
        if (normalized.isBlank()) return UUID.randomUUID().toString();
        return normalized.substring(0, Math.min(128, normalized.length()));
    }
}
