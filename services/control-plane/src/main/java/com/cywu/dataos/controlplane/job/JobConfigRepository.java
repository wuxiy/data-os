package com.cywu.dataos.controlplane.job;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JobConfigRepository {

    private static final TypeReference<Map<String, Object>> CONFIG_TYPE = new TypeReference<>() {
    };

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public JobConfigRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public Optional<IngestionJobConfig> findByJobId(String jobId) {
        return jdbc.query("""
                SELECT job_id, template_key, template_version, config_json, updated_at
                FROM data_os.ingestion_job_configs
                WHERE job_id = ?
                """, (resultSet, rowNumber) -> new IngestionJobConfig(
                resultSet.getString("job_id"),
                resultSet.getString("template_key"),
                resultSet.getInt("template_version"),
                readConfig(resultSet.getString("config_json")),
                resultSet.getTimestamp("updated_at").toInstant()), jobId).stream().findFirst();
    }

    public IngestionJobConfig save(String jobId, SaveJobConfigRequest request, Instant updatedAt) {
        var json = writeConfig(request.config());
        jdbc.update("DELETE FROM data_os.ingestion_job_configs WHERE job_id = ?", jobId);
        jdbc.update("""
                INSERT INTO data_os.ingestion_job_configs
                    (job_id, template_key, template_version, config_json, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """, jobId, request.templateKey().trim(), request.templateVersion(), json, Timestamp.from(updatedAt));
        return new IngestionJobConfig(jobId, request.templateKey().trim(), request.templateVersion(),
                request.config(), updatedAt);
    }

    private Map<String, Object> readConfig(String json) {
        try {
            return objectMapper.readValue(json, CONFIG_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("任务配置存储内容无法解析", exception);
        }
    }

    private String writeConfig(Map<String, Object> config) {
        try {
            return objectMapper.writeValueAsString(config);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("任务配置无法序列化", exception);
        }
    }
}
