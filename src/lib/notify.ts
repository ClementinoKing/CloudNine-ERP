import { toast } from 'sonner'

type NotifyOptions = {
  description?: string
}

export const notify = {
  success(title: string, options?: NotifyOptions) {
    toast.success(title, {
      description: options?.description,
    })
  },
  error(title: string, options?: NotifyOptions) {
    toast.error(title, {
      description: options?.description,
    })
  },
  warning(title: string, options?: NotifyOptions) {
    toast.warning(title, {
      description: options?.description,
      position: 'top-right',
    })
  },
  info(title: string, options?: NotifyOptions) {
    toast.info(title, {
      description: options?.description,
    })
  },
}

