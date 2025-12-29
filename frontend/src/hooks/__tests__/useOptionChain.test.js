// Tests for useOptionChain hook – verifies spot price reset on expiry change
import { renderHook, act } from '@testing-library/react-hooks';
import { useOptionChain } from '../useOptionChain';

// Mock fetch responses
global.fetch = jest.fn();

const mockChainResponse = (spotPrice) => {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      data: {
        spotPrice,
        chain: [],
        expiry: '2024-12-31'
      }
    })
  });
};

describe('useOptionChain', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  it('clears spotPrice when expiry changes and fetches new spotPrice', async () => {
    // First fetch returns spotPrice 100
    fetch.mockImplementationOnce(() => mockChainResponse(100));
    const { result, waitForNextUpdate } = renderHook(() =>
      useOptionChain({ name: 'NIFTY', expiry: '2024-12-31' })
    );
    await waitForNextUpdate();
    expect(result.current.spotPrice).toBe(100);

    // Change expiry – mock new spotPrice 105
    fetch.mockImplementationOnce(() => mockChainResponse(105));
    act(() => {
      result.current.refetch();
    });
    await waitForNextUpdate();
    expect(result.current.spotPrice).toBe(105);
  });
});
