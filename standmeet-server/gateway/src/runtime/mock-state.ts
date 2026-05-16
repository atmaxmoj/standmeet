interface MockConfig {
  enabled: boolean;
  response: string;
  delayMs: number;
  sources: string[];
  simulateExpiredSession: boolean;
}

const DEFAULT_RESPONSE = "This is a mock AI response.";
const DEFAULT_DELAY_MS = 50;

let mockConfig: MockConfig = {
  enabled: false,
  response: DEFAULT_RESPONSE,
  delayMs: DEFAULT_DELAY_MS,
  sources: [],
  simulateExpiredSession: false,
};

export function getMockConfig(): Readonly<MockConfig> {
  return mockConfig;
}

export function setMockConfig(partial: Partial<Omit<MockConfig, "enabled">>): void {
  mockConfig = { ...mockConfig, ...partial };
}

export function resetMockConfig(): void {
  mockConfig = {
    enabled: mockConfig.enabled, // preserve enabled state
    response: DEFAULT_RESPONSE,
    delayMs: DEFAULT_DELAY_MS,
    sources: [],
    simulateExpiredSession: false,
  };
}

export function enableMock(): void {
  mockConfig = { ...mockConfig, enabled: true };
}
