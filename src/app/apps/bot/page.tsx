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
      <OneAIBotBridgePanel />
    </ProductPage>
  );
}
