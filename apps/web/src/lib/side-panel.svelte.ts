/**
 * Which side panel the developer tools hold. The side slot shows one panel at a time: while the
 * developer panel (test builds) is open it takes the place of «Мета», which comes back when it closes.
 */
export const sidePanel = $state({ dev: false });
