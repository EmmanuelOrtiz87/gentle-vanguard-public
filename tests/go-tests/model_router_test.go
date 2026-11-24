package main

import (
	"testing"
	"time"
)

// ModelConfig representa una config de modelo
type ModelConfig struct {
	Name         string
	CostPer1KIn  float64
	CostPer1KOut float64
	Provider     string
}

func TestModelConfigValidation(t *testing.T) {
	tests := []struct {
		name    string
		config  ModelConfig
		wantErr bool
	}{
		{
			name: "valid config",
			config: ModelConfig{
				Name:         "qwen-3.6-plus",
				CostPer1KIn:  0.00015,
				CostPer1KOut: 0.00015,
				Provider:     "openrouter",
			},
			wantErr: false,
		},
		{
			name: "empty name",
			config: ModelConfig{
				Name:         "",
				CostPer1KIn:  0.00015,
				CostPer1KOut: 0.00015,
				Provider:     "openrouter",
			},
			wantErr: true,
		},
		{
			name: "negative cost",
			config: ModelConfig{
				Name:         "test-model",
				CostPer1KIn:  -1.0,
				CostPer1KOut: 0.00015,
				Provider:     "openrouter",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateModelConfig(tt.config)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateModelConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func validateModelConfig(c ModelConfig) error {
	if c.Name == "" {
		return &configError{"model name cannot be empty"}
	}
	if c.CostPer1KIn < 0 || c.CostPer1KOut < 0 {
		return &configError{"cost cannot be negative"}
	}
	if c.Provider == "" {
		return &configError{"provider cannot be empty"}
	}
	return nil
}

type configError struct {
	msg string
}

func (e *configError) Error() string { return e.msg }

func TestTokenBudgetCalculation(t *testing.T) {
	budget := struct {
		Daily    int
		SoftPct  float64
		HardPct  float64
		CostPct  float64
	}{
		Daily:   30000,
		SoftPct: 0.70,
		HardPct: 0.90,
		CostPct: 0.80,
	}

	if budget.Daily <= 0 {
		t.Error("daily budget must be positive")
	}
	if budget.SoftPct >= budget.HardPct {
		t.Error("soft threshold must be less than hard threshold")
	}
	if budget.CostPct <= budget.SoftPct || budget.CostPct >= budget.HardPct {
		t.Error("cost alert threshold must be between soft and hard")
	}
}

func TestCostCalculation(t *testing.T) {
	tokens := 1000
	costPer1K := 0.00015
	expected := float64(tokens) / 1000 * costPer1K

	if expected != 0.00015 {
		t.Errorf("expected 0.00015, got %f", expected)
	}
}

func TestProviderFailoverPriority(t *testing.T) {
	providers := []struct {
		Name     string
		Priority int
		Cost     float64
	}{
		{Name: "ollama", Priority: 0, Cost: 0},
		{Name: "openrouter", Priority: 1, Cost: 0.00015},
		{Name: "anthropic", Priority: 2, Cost: 0.00025},
	}

	for i := 1; i < len(providers); i++ {
		if providers[i].Cost < providers[i-1].Cost && providers[i].Priority > providers[i-1].Priority {
			t.Errorf("provider %s has lower cost but higher priority than %s",
				providers[i].Name, providers[i-1].Name)
		}
	}
}

func TestSessionTokenTracking(t *testing.T) {
	type TokenRecord struct {
		SessionID string
		Tokens    int
		Cost      float64
		Timestamp time.Time
	}

	session := TokenRecord{
		SessionID: "session-20260601-101500",
		Tokens:    15000,
		Cost:      0.45,
		Timestamp: time.Now(),
	}

	if session.Tokens <= 0 {
		t.Error("token count must be positive")
	}
	if session.Cost <= 0 {
		t.Error("cost must be positive")
	}
	if session.SessionID == "" {
		t.Error("session ID cannot be empty")
	}
}
