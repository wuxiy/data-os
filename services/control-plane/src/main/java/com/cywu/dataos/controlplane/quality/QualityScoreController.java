package com.cywu.dataos.controlplane.quality;

import java.util.List;
import java.util.Map;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 质量评分面（G2G 批次 3）：聚合读模型 + 单一生效标准编辑。 */
@RestController
@RequestMapping("/api/v1/quality/score")
public class QualityScoreController {

    private final QualityScoreService service;

    public QualityScoreController(QualityScoreService service) {
        this.service = service;
    }

    @GetMapping
    public QualityScoreService.ScoreSummary score() {
        return service.score();
    }

    @GetMapping("/standard")
    public QualityScoreService.ScoreStandardView standard() {
        return service.standard();
    }

    /** 更新单一生效标准：字段缺省保持现值。 */
    @PutMapping("/standard")
    public QualityScoreService.ScoreStandardView updateStandard(
            @Valid @RequestBody UpdateStandardRequest request) {
        return service.updateStandard(request.passScore(), request.weights(), request.grades());
    }

    public record UpdateStandardRequest(Double passScore, Map<String, Integer> weights,
                                        List<Map<String, Object>> grades) {
    }
}
