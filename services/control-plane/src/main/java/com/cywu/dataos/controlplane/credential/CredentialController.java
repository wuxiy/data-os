package com.cywu.dataos.controlplane.credential;

import java.net.URI;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/credentials")
public class CredentialController {

    private final CredentialService service;

    public CredentialController(CredentialService service) {
        this.service = service;
    }

    @GetMapping
    public List<CredentialService.CredentialSummary> list() {
        return service.list();
    }

    @PostMapping
    public ResponseEntity<CredentialService.CredentialSummary> create(
            @Valid @RequestBody CreateCredentialRequest request) {
        var result = service.create(new CredentialService.CreateCredentialRequest(request.name(), request.provider(),
                request.secret(), request.metadata()));
        return ResponseEntity.created(URI.create("/api/v1/credentials/" + result.id())).body(result);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    public record CreateCredentialRequest(
            @NotBlank(message = "name 不能为空") @Size(max = 200, message = "name 不能超过 200 个字符") String name,
            @NotBlank(message = "provider 不能为空") @Size(max = 64, message = "provider 不能超过 64 个字符") String provider,
            java.util.Map<String, Object> secret,
            java.util.Map<String, Object> metadata) {
    }
}
