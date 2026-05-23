import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { OneAIBotBridgePanel } from '@/components/theone/OneAIBotBridgePanel';
import { ProductPage, ProductStatusStrip } from '@/components/theone/ProductNav';

export default function OneAIBotAppPage() {
  return (
    <ProductPage
      eyebrow="OneAI Bot App"
      title="Community bot bridge"
      subtitle="Bring the existing WAOC OneAI Telegram Bot into TheOne as a governed runtime without changing the bot code."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Runtime', value: 'Bot', tone: 'assist' },
            { label: 'Bridge', value: 'read-only', tone: 'online' },
            { label: 'Code', value: 'unchanged', tone: 'online' },
          ]}
        />
      )}
    >
      <section className="app-workflow-band">
        <div><span>1</span><strong>Register runtime</strong><p>TheOne treats the existing Bot as an external App/Worker without changing its code.</p></div>
        <div><span>2</span><strong>Check bridge</strong><p>TheOne performs a read-only health and contract check.</p></div>
        <div><span>3</span><strong>Route later</strong><p>Future Telegram-triggered work can be governed by TheOne policy and proof.</p></div>
      </section>
      <OneAIBotBridgePanel />
      <AppMemoryRecall app="bot" title="Bot Memory" detail="Bridge checks and community runtime context saved from the OneAI Bot App." />
    </ProductPage>
  );
}
