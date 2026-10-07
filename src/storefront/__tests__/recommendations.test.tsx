import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { Recommendations } from "@/components/store/Recommendations";
import { cartStore } from "@/lib/commerce/cart-store";
import type { Product } from "@/lib/commerce/merchant";

function product(id: string, name: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    sku: id.toUpperCase(),
    name,
    base_price: 4500,
    compare_at_price: null,
    stock_count: 20,
    min_margin: 0.2,
    image_url: `/${id}.jpeg`,
    category: "tops",
    subcategory: null,
    description: null,
    attributes: [],
    ...overrides,
  };
}

const CATALOG: Record<string, Product> = {
  prod_2: product("prod_2", "Slim Jeans", { base_price: 6000, compare_at_price: 8000 }),
  prod_3: product("prod_3", "Canvas Cap"),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const RESULT = {
  isError: false,
  result: {
    recommendationRequestId: "rec_abc123",
    recommendations: [
      { productId: "prod_3", productName: "Canvas Cap", rank: 2, reasoning: "Tops off the look" },
      { productId: "prod_2", productName: "Slim Jeans", rank: 1, reasoning: "Classic pairing" },
      { productId: "prod_1", productName: "Classic Tee", rank: 3, reasoning: "Self" },
    ],
  },
};

const fetchMock = vi.fn<typeof fetch>();

function mcpCalls() {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/mcp-proxy")
    .map(([, init]) => ({
      init,
      body: JSON.parse(String(init?.body)) as { name: string; arguments: Record<string, unknown> },
    }));
}

function serve(mcpReply: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/mcp-proxy") return mcpReply();
    const id = /^\/api\/proxy\/merchant\/products\/(prod_\w+)$/.exec(url)?.[1];
    const found = id ? CATALOG[id] : undefined;
    return found ? json(found) : json({ detail: "Not found" }, 404);
  });
}

beforeEach(() => {
  cartStore.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Recommendations", () => {
  it("shows a loading skeleton, then hydrated cards in rank order without the current product", async () => {
    serve(() => json(RESULT));
    render(<Recommendations productId="prod_1" productName="Classic Tee" />);

    const section = screen.getByRole("region", { name: "You might also like" });
    expect(section).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading recommendations");

    const links = await within(section).findAllByRole("link");
    expect(section).toHaveAttribute("aria-busy", "false");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/products/prod_2",
      "/products/prod_3",
    ]);
    expect(within(links[0]!).getByText("Classic pairing")).toBeInTheDocument();
    expect(within(links[0]!).getByText("$60.00")).toBeInTheDocument();
    expect(within(links[0]!).getByText("Sale")).toBeInTheDocument();
  });

  it("sends the current product and cart context", async () => {
    cartStore.add({ id: "prod_9", name: "Wool Socks", price: 1200, imageUrl: "/prod_9.jpeg" }, 2);
    serve(() => json(RESULT));
    render(<Recommendations productId="prod_1" productName="Classic Tee" />);
    await screen.findAllByRole("link");

    expect(mcpCalls()[0]?.body).toEqual({
      name: "get-recommendations",
      arguments: {
        productId: "prod_1",
        productName: "Classic Tee",
        cartItems: [{ productId: "prod_9", name: "Wool Socks", price: 1200 }],
        sessionId: null,
      },
    });
  });

  it("tracks the click with its position before navigating", async () => {
    serve(() => json(RESULT));
    render(<Recommendations productId="prod_1" productName="Classic Tee" />);
    const [, second] = await screen.findAllByRole("link");

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(json({ result: { recorded: true }, isError: false }));
    // jsdom cannot navigate; cancel the default action after handlers have run.
    const stopNavigation = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("click", stopNavigation);
    fireEvent.click(second!);
    window.removeEventListener("click", stopNavigation);

    const [click] = mcpCalls();
    expect(click?.init?.keepalive).toBe(true);
    expect(click?.body).toEqual({
      name: "track-recommendation-click",
      arguments: {
        productId: "prod_3",
        recommendationRequestId: "rec_abc123",
        sessionId: null,
        position: 2,
        source: "storefront_pdp",
      },
    });
  });

  it.each([
    ["an HTTP error", () => json({ error: "Recommendations are unavailable right now" }, 502)],
    ["a tool error", () => json({ result: null, isError: true })],
    ["an empty list", () => json({ result: { recommendations: [] }, isError: false })],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("hides itself on %s", async (_label, reply) => {
    serve(reply);
    const { container } = render(<Recommendations productId="prod_1" productName="Classic Tee" />);
    expect(screen.getByRole("region")).toBeInTheDocument();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("hides itself when no recommended product can be loaded", async () => {
    serve(() =>
      json({
        isError: false,
        result: { recommendations: [{ productId: "prod_404", productName: "Gone", rank: 1 }] },
      })
    );
    const { container } = render(<Recommendations productId="prod_1" productName="Classic Tee" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
