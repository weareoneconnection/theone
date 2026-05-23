const ITEMS = [
  'Earn money',
  'Grow followers',
  'Launch missions',
  'Build AI workflows',
];

export function NetworkHeat() {
  return (
    <section className="panel-card">
      <h2 className="panel-title">Network Heat</h2>
      <div className="heat-list">
        {ITEMS.map((item) => (
          <div key={item} className="heat-item">
            {item}
          </div>
        ))}
      </div>
      <div className="footer-note">
        Network signals are ready for OneField and live community activity.
      </div>
    </section>
  );
}
