import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  REDIS_HOST: Joi.alternatives()
    .try(
      Joi.string().hostname(),
      Joi.string().ip({ version: ['ipv4', 'ipv6'] }),
    )
    .required()
    .label('REDIS_HOST')
    .messages({
      'alternatives.match':
        '"REDIS_HOST" must be a valid hostname or IP address',
      'any.required': '"REDIS_HOST" is required and cannot be empty',
    }),

  REDIS_PORT: Joi.number().port().required().label('REDIS_PORT').messages({
    'number.port': '"REDIS_PORT" must be a valid port number',
  }),

  REDIS_PASSWORD: Joi.string().required().label('REDIS_PASSWORD').messages({
    'any.required':
      '"REDIS_PASSWORD" is required (can be empty string if no password)',
  }),

  REDIS_DB: Joi.number().min(0).required().label('REDIS_DB').messages({
    'number.min': '"REDIS_DB" must be greater than or equal to 0',
    'any.required': '"REDIS_DB" is required',
  }),
  REDIS_USERNAME: Joi.string().default('').label('REDIS_USERNAME').messages({
    'any.required':
      '"REDIS_USERNAME" is required (can be empty string if no username)',
  }),
  REDIS_KEY_PREFIX: Joi.string()
    .allow('')
    .required()
    .label('REDIS_KEY_PREFIX')
    .messages({
      'any.required':
        '"REDIS_KEY_PREFIX" is required (can be empty string if no key prefix)',
    }),
  REDIS_TLS: Joi.boolean().required().label('REDIS_TLS').messages({
    'any.required': '"REDIS_TLS" is required',
  }),
});
