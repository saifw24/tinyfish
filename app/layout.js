import "./globals.css";
export const metadata = { title: "Student Rail Arbitrage", description: "The smallest change to your travel plans that produces the biggest saving." };
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>);
}
