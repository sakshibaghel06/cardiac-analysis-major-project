function StartupNotice({ title, children }) {
  return (
    <main className="startup-screen">
      <section className="startup-card" role="alert">
        <div className="startup-brand">CardioCare</div>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export default StartupNotice;
