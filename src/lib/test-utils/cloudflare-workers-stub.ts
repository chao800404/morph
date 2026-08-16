export const env = {
  DATABASE: {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({}),
      }),
    }),
    batch: async () => [],
  },
};
