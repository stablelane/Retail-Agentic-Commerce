/** Pre-authenticated demo persona, mirrored from the Apps SDK (`DEFAULT_USER`). */
export const MOCK_USER = {
  id: "user_demo123",
  name: "John Doe",
  email: "john@example.com",
  /** UPI ReservePay identity; any 10-digit Indian mobile works in the Pine Labs sandbox. */
  mobile: "9876543210",
  loyaltyPoints: 1250,
  tier: "Gold",
  memberSince: "2024-03-15",
} as const;

export type MockUser = typeof MOCK_USER;

/** Default ship-to address, matching the Apps SDK widget's `DEFAULT_FULFILLMENT_ADDRESS`. */
export const MOCK_USER_ADDRESS = {
  name: "John Doe",
  line_one: "123 AI Boulevard",
  city: "San Francisco",
  state: "CA",
  postal_code: "94102",
  country: "US",
} as const;

export const MOCK_BUYER = {
  first_name: "John",
  last_name: "Doe",
  email: MOCK_USER.email,
} as const;
