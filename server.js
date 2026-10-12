import app from "./server-app.js";
export default app;
if (process.env.VERCEL !== "1") {
  const PORT = process.env.PORT || 8787;
  app.listen(PORT, () => {
    console.log(`Phoveus backend proxy running at http://localhost:${PORT}`);
  });
}
