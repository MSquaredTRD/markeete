# Markeete

Non-custodial USDC escrow marketplace deployed on Base and Cloudflare Workers.

Production: https://markeete.online

DeliveryEscrow V2: [`0x642da3859deD225Cf42efd21346e317e8e26F58e`](https://basescan.org/address/0x642da3859deD225Cf42efd21346e317e8e26F58e#code)

ProductMetadataRegistry: [`0xFC707ebB5A9987231e4e1FcA20bB40C2159B4016`](https://basescan.org/address/0xFC707ebB5A9987231e4e1FcA20bB40C2159B4016#code)

DeliveryEscrow V2 holds USDC and implements the product, order, courier, delivery, return, timeout and pull-payment state machines. ProductMetadataRegistry stores seller-authored public catalog bytes only when their hash matches the product commitment in DeliveryEscrow. The registry has no owner, upgrade path, token withdrawal or fee functions.

- [Technical reference](https://markeete.online/technical-reference.md)
- [Whitepaper](https://markeete.online/whitepaper.md)
- [Bot integration guide](https://markeete.online/bot-guide.md)
- [Risk disclosure](https://markeete.online/risk-disclosure.md)
