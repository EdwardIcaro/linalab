declare module 'pix-payload' {
  export interface PayloadProps {
    name: string;
    key: string;
    amount?: number;
    city: string;
    transactionId?: string;
  }
  export function payload(props: PayloadProps): string;
}
